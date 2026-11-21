// Single source of truth for user-facing product naming.
// brand.config.json feeds the generated manifest; keep strings in sync via this module.
import brand from '../../brand.config.json';

export const PRODUCT_NAME = brand.productName;
export const TAGLINE = brand.tagline;
export const STORE_TITLE = brand.storeTitle;
