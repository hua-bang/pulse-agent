#!/usr/bin/env python3
"""Generate app icons from the Pulse Canvas brand mark."""

import os
import shutil
import subprocess
import tempfile
from PIL import Image
from PIL import ImageDraw

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.path.join(BASE_DIR, "build")
RESOURCES_DIR = os.path.join(BASE_DIR, "resources")
PUBLIC_DIR = os.path.join(BASE_DIR, "src", "renderer", "public")
SVG_PATH = os.path.join(BUILD_DIR, "icon.svg")

# Electron-builder expects these in build/
# Common sizes for app icons
SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 32, 48, 64, 128, 256]

VIEWBOX_SIZE = 512
RECT = (32, 32, 480, 480)
RECT_RADIUS = 96
PULSE_POINTS = [
    (80, 268),
    (188, 268),
    (228, 178),
    (260, 370),
    (292, 148),
    (328, 268),
    (432, 268),
]
PULSE_WIDTH = 22
BACKGROUND = "#FFFFFF"
FOREGROUND = "#1D1D1F"
SUPERSAMPLE = 4


def draw_brand_icon(size: int) -> Image.Image:
    """Draw the same boxed waveform mark used inside the app."""
    scale = size * SUPERSAMPLE / VIEWBOX_SIZE
    canvas_size = size * SUPERSAMPLE
    img = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    rect = tuple(round(value * scale) for value in RECT)
    radius = round(RECT_RADIUS * scale)
    draw.rounded_rectangle(rect, radius=radius, fill=BACKGROUND)

    points = [(round(x * scale), round(y * scale)) for x, y in PULSE_POINTS]
    line_width = max(1, round(PULSE_WIDTH * scale))
    draw.line(points, fill=FOREGROUND, width=line_width, joint="curve")

    cap_radius = line_width / 2
    for x, y in points:
        draw.ellipse(
            (
                x - cap_radius,
                y - cap_radius,
                x + cap_radius,
                y + cap_radius,
            ),
            fill=FOREGROUND,
        )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def create_png(output_path: str, size: int):
    """Create a PNG at a specific size."""
    img = draw_brand_icon(size)
    img.save(output_path, "PNG")
    print(f"  Created: {os.path.basename(output_path)} ({size}x{size})")


def create_ico(output_path: str):
    """Create ICO file with multiple sizes."""
    img = draw_brand_icon(max(ICO_SIZES))
    img.save(
        output_path,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )
    print(f"  Created: {os.path.basename(output_path)} (multi-size ICO)")


def create_icns(output_path: str):
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
                draw_brand_icon(size).save(os.path.join(iconset_dir, filename), "PNG")
            subprocess.run(
                [iconutil, "-c", "icns", iconset_dir, "-o", output_path],
                check=True,
                capture_output=True,
                text=True,
            )
            print(f"  Created: {os.path.basename(output_path)} (macOS ICNS)")
    except subprocess.CalledProcessError as error:
        print(f"  Skipped: icon.icns (iconutil failed: exit {error.returncode})")


def main():
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(RESOURCES_DIR, exist_ok=True)
    os.makedirs(PUBLIC_DIR, exist_ok=True)

    print("Generating Pulse Canvas icons from the in-app brand mark...")
    print()

    # 1. Generate PNGs in build/ (for electron-builder)
    print("[build/] Electron-builder icons:")
    for size in SIZES:
        output = os.path.join(BUILD_DIR, f"icon-{size}x{size}.png")
        create_png(output, size)

    # Main icon.png (512x512, electron-builder default)
    create_png(os.path.join(BUILD_DIR, "icon.png"), 512)

    # 2. Generate ICO (Windows)
    print()
    print("[build/] Windows ICO:")
    create_ico(os.path.join(BUILD_DIR, "icon.ico"))

    # 3. Generate ICNS (macOS)
    print()
    print("[build/] macOS ICNS:")
    create_icns(os.path.join(BUILD_DIR, "icon.icns"))

    # 4. Copy key files to resources/ for runtime use
    print()
    print("[resources/] Runtime resources:")
    create_png(os.path.join(RESOURCES_DIR, "icon.png"), 512)
    create_png(os.path.join(RESOURCES_DIR, "icon@2x.png"), 1024)

    # Tray icon (smaller, for system tray)
    for size in [16, 32]:
        create_png(os.path.join(RESOURCES_DIR, f"tray-{size}x{size}.png"), size)

    # 5. Keep renderer favicon assets aligned with the app icon.
    print()
    print("[src/renderer/public/] Renderer icons:")
    shutil.copyfile(SVG_PATH, os.path.join(PUBLIC_DIR, "icon.svg"))
    print("  Copied: icon.svg")
    create_png(os.path.join(PUBLIC_DIR, "icon.png"), 512)

    print()
    print("Done! All icons generated successfully.")


if __name__ == "__main__":
    main()
