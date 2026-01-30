export function makeLogger(prefix, envKey = "DEBUG") {
  const on = process.env[envKey] === "1";
  return (...a) => on && console.log(prefix, ...a);
}
