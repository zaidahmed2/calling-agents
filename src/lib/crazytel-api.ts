export function getCrazytelApiBaseUrl(value: string): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new Error("Enter a valid Crazytel API base URL.");
  }
  if (
    baseUrl.protocol !== "https:"
    || !["api.crazytel.io", "crazytel.io"].includes(baseUrl.hostname)
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
    || (baseUrl.port && baseUrl.port !== "443")
  ) {
    throw new Error("Use the official Crazytel API host over HTTPS.");
  }
  return baseUrl;
}
