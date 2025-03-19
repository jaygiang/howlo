// Helper function to construct proper URLs without double slashes
export function buildUrl(basePath, path) {
  const base = basePath || 'https://your-app.vercel.app';
  // Remove trailing slash from base if it exists
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  // Ensure path starts with a slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${cleanBase}${cleanPath}`;
}
