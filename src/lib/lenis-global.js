// Artifact builds load Lenis from a pinned CDN script (the artifact CSP only
// admits scripts from a few CDNs), so `import Lenis from 'lenis'` resolves
// here and hands back the global that script defines.
export default globalThis.Lenis;
