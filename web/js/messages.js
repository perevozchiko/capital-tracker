import en from './i18n/en.js';
function t(key) {
  return en[key] || key;
}

export { t };
