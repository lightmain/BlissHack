declare const __BLISSHACK_PRODUCT_VERSION__: string;

/** Player-visible BlissHack milestone from the repository VERSION file. */
export const PRODUCT_VERSION = __BLISSHACK_PRODUCT_VERSION__;

/**
 * Resolve deployment metadata without treating it as a product version.
 * @param buildId - build identifier supplied by the deployment environment.
 * @returns the supplied identifier or the explicit local-development value.
 */
export function resolveBuildId(buildId: string | undefined): string {
  return buildId ?? `${PRODUCT_VERSION}-development`;
}

/** Deployment commit or an explicit identifier for local development builds. */
export const BUILD_ID = resolveBuildId(import.meta.env.VITE_BUILD_ID);
