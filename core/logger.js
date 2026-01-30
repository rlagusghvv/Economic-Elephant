// core/logger.js (ESM)
// DEBUG_* 환경변수 기반으로 로그 on/off

export function makeLogger(prefix, envKey = "DEBUG") {
  const enabled = process.env[envKey] === "1";
  return (...args) => {
    if (enabled) console.log(prefix, ...args);
  };
}
