export function printResult(json, value, lines) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}

export function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
