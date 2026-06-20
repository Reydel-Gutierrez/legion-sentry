import logoUrl from '../Sentry-logo.svg';

export const BRANDING = {
  productName: 'Sentry G1',
  manufacturer: 'Legion Controls',
  productCode: 'LCG1DEV10026',
  logo: logoUrl,
};

export function getDocumentTitle(pageTitle) {
  const base = `${BRANDING.manufacturer} ${BRANDING.productName}`;
  return pageTitle ? `${pageTitle} · ${base}` : base;
}

export function getLoginTitle() {
  return `${BRANDING.productName} Login`;
}
