#!/usr/bin/env python3
"""Generate app icons from resources/pulse.png."""

import os
import subprocess
import tempfile
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.path.join(BASE_DIR, "build")
RESOURCES_DIR = os.path.join(BASE_DIR, "resources")
PUBLIC_DIR = os.path.join(BASE_DIR, "src", "renderer", "public")
SOURCE_PATH = os.path.join(RESOURCES_DIR, "pulse.png")

# Electron-builder expects these in build/
# Common sizes for app icons
SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def load_source_icon() -> Image.Image:
    """Load and normalize the app icon source image."""
    if not os.path.exists(SOURCE_PATH):
        raise FileNotFoundError(f"Missing source icon: {SOURCE_PATH}")
    return Image.open(SOURCE_PATH).convert("RGBA")


def render_icon(source: Image.Image, size: int) -> Image.Image:
    """Resize the source image to a square app-icon target size."""
    source_width, source_height = source.size
    crop_size = min(source_width, source_height)
    left = (source_width - crop_size) // 2
    top = (source_height - crop_size) // 2
    cropped = source.crop((left, top, left + crop_size, top + crop_size))
    return cropped.resize((size, size), Image.Resampling.LANCZOS)


def create_png(source: Image.Image, output_path: str, size: int):
    """Create a PNG at a specific size."""
    img = render_icon(source, size)
    img.save(output_path, "PNG")
    print(f"  Created: {os.path.basename(output_path)} ({size}x{size})")


def create_ico(source: Image.Image, output_path: str):
    """Create ICO file with multiple sizes."""
    img = render_icon(source, max(ICO_SIZES))
    img.save(
        output_path,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )
    print(f"  Created: {os.path.basename(output_path)} (multi-size ICO)")


def create_icns(source: Image.Image, output_path: str):
    """Create a macOS ICNS file when iconutil is available."""
    iconutil = shutil.which("iconutil")
    if not iconutil:
        print("  Skipped: icon.icns (iconutil not found)")
        return

    iconset_names = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            iconset_dir = os.path.join(tmp, "icon.iconset")
            os.makedirs(iconset_dir, exist_ok=True)
            for filename, size in iconset_names:
                render_icon(source, size).save(os.path.join(iconset_dir, filename), "PNG")
            subprocess.run(
                [iconutil, "-c", "icns", iconset_dir, "-o", output_path],
                check=True,
                capture_output=True,
                text=True,
            )
            print(f"  Created: {os.path.basename(output_path)} (macOS ICNS)")
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        suffix = f": {detail}" if detail else ""
        print(f"  Skipped: icon.icns (iconutil failed: exit {error.returncode}{suffix})")


def main():
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(RESOURCES_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)

    source = load_source_icon()

    print("Generating Pulse Canvas icons from resources/pulse.png...")
    print()

    # 1. Generate PNGs in build/ (for electron-builder)
    print("[build/] Electron-builder icons:")
    for size in SIZES:
        output = os.path.join(BUILD_DIR, f"icon-{size}x{size}.png")
        create_png(source, output, size)

    # Main icon.png (512x512, electron-builder default)
    create_png(source, os.path.join(BUILD_DIR, "icon.png"), 512)

    # 2. Generate ICO (Windows)
    print()
    print("[build/] Windows ICO:")
    create_ico(source, os.path.join(BUILD_DIR, "icon.ico"))

    # 3. Generate ICNS (macOS)
    print()
    print("[build/] macOS ICNS:")
    create_icns(source, os.path.join(BUILD_DIR, "icon.icns"))

    # 4. Copy key files to resources/ for runtime use
    print()
    print("[resources/] Runtime resources:")
    create_png(source, os.path.join(RESOURCES_DIR, "icon.png"), 512)
    create_png(source, os.path.join(RESOURCES_DIR, "icon@2x.png"), 1024)

    # Tray icon (smaller, for system tray)
    for size in [16, 32]:
        create_png(source, os.path.join(RESOURCES_DIR, f"tray-{size}x{size}.png"), size)

    # 5. Keep renderer favicon assets aligned with the app icon.
    print()
    print("[src/renderer/public/] Renderer icons:")
    create_png(source, os.path.join(PUBLIC_DIR, "icon.png"), 512)

    print()
    print("Done! All icons generated successfully.")


if __name__ == "__main__":
    main()
