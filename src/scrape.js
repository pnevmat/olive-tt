const {chromium} = require('playwright');
const fs = require('fs/promises');

const TARGET_URL =
  'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';

// {
// "url": "string",
// "item_id": "string | null",
// "title": "string | null",
// "brand": "string | null",
// "product_category": "string | null",
// "category_tree": [
// {
// "name": "string",
// "url": "string | null"
// }
// ],
// "description": "string | null",
// "price": "number | null",
// "sale_price": "number | null",
// "availability": "\"in_stock\" | \"out_of_stock\" | \"pre_order\" | null",
// "image_url": "string | null",
// "additional_image_urls": [
// "string"
// ],
// "specs": [
// {
// "name": "string",
// "value": "string | null"
// }
// ],
// "star_rating": "number | null",
// "review_count": "number | null",
// "gtin": "string | null",
// "mpn": "string | null",
// "scraped_at": "ISO 8601 datetime string"
// }

const start = async (TARGET_URL) => {
  try {
    const browser = await chromium.launch({headless: false});
    const page = await browser.newPage();

    await page.goto(TARGET_URL);
    await page.waitForURL('', {waitUntil: 'networkidle'});

    return page;
  } catch (e) {
    return e;
  }
};

const getProductId = async (page, url) => {
  try {
    const idFromData = await page.evaluate(() => {
      return (
        window?.productData?.id ||
        window?.dataLayer?.[0]?.ecommerce?.detail?.products?.[0]?.id ||
        null
      );
    });

    if (idFromData) return String(idFromData);

    const urlMatch =
      url.match(
        /(?:products?|items?|goods|details?|[\/][p][\/])\/([a-zA-Z0-9_-]+)/i,
      ) || url.match(/(?:\?|&)id=([a-zA-Z0-9_-]+)/i);

    if (urlMatch && urlMatch[1]) return urlMatch[1];

    const idFromHtml = await page.evaluate(() => {
      const metaId = document
        .querySelector('meta[property="product:id"]')
        ?.getAttribute('content');
      const dataId = document
        .querySelector('[data-product-id]')
        ?.getAttribute('data-product-id');
      const inputId = document.querySelector('input[name="product_id"]')?.value;
      const skuId = document
        .querySelector('.product-sku, .sku-number')
        ?.innerText?.replace('SKU:', '')
        .trim();
      console.log('GetProductId mtaId: ', metaId);
      console.log('GetProductId dataId: ', dataId);
      console.log('GetProductId inputId: ', inputId);
      console.log('GetProductId skuId: ', skuId);
      return metaId || dataId || inputId || skuId || null;
    });

    if (idFromHtml) return String(idFromHtml);

    return null;
  } catch (e) {
    return e;
  }
};

const getProductTitle = async (page) => {
  try {
    const h1Title = await page.locator('h1').first().textContent();

    if (h1Title && h1Title.trim()) return h1Title.trim();

    const metaTitle = await page.evaluate(() => {
      return (
        document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute('content') ||
        document
          .querySelector('meta[name="twitter:title"]')
          ?.getAttribute('content') ||
        document.title
      );
    });

    if (metaTitle && metaTitle.trim()) {
      return metaTitle.split(/[|•-]/)[0].trim();
    }
  } catch (e) {
    return e;
  }
};

const getBrandFromSiteMeta = async (page) => {
  try {
    const brand = await page.evaluate(() => {
      const siteName = document
        .querySelector('meta[property="og:site_name"]')
        ?.getAttribute('content');

      if (siteName) return siteName.trim();

      const pageTitle = document.title;

      if (pageTitle) {
        const parts = pageTitle.split(/[|•-]/);

        return parts.length > 1
          ? parts[parts.length - 1].trim()
          : pageTitle.trim();
      }

      return null;
    });

    return brand ? brand.replace(/(Official Store|Shop)/gi, '').trim() : null;
  } catch (e) {
    return e;
  }
};

const getProductCategory = async (page) => {
  try {
    const categoryData = await page.evaluate(() => {
      const breadcrumbContainer = document.querySelector(
        '.breadcrumbs, .breadcrumb, [class*="breadcrumb"], nav[aria-label="Breadcrumb"]',
      );

      if (!breadcrumbContainer) return null;

      const items = Array.from(
        breadcrumbContainer.querySelectorAll(
          'li, a, span:not([class*="current"])',
        ),
      );

      const categories = items
        .map((item) => item.innerText.replace(/[\n\t\/\>]/g, '').trim())
        .filter((text) => {
          const lowerText = text.toLowerCase();
          return (
            text.length > 0 &&
            ![
              'home',
              'main',
              'главная',
              'shop',
              'catalog',
              'каталог',
              'все товары',
              'all products',
            ].includes(lowerText)
          );
        });

      if (categories.length === 0) return null;

      return {
        allCategories: categories,
        lastCategory: categories[categories.length - 1],
      };
    });

    return categoryData;
  } catch (e) {
    return e;
  }
};

const getDetailedBreadcrumbs = async (page) => {
  try {
    const breadcrumbs = await page.evaluate(() => {
      const container = document.querySelector(
        '.breadcrumbs, .breadcrumb, [class*="breadcrumb"], nav[aria-label="Breadcrumb"]',
      );

      if (!container) return [];

      const items = Array.from(
        container.querySelectorAll('li, a, [class*="item"]'),
      );

      const result = [];

      items.forEach((item) => {
        const anchor = item.tagName === 'A' ? item : item.querySelector('a');
        // Видобування та очистка тексту (видалення розділювачів /, >, переносів рядка та табуляції)
        let name = item.innerText
          ? item.innerText.replace(/[\n\t\/\>]/g, '').trim()
          : '';
        // Видобування посилання, якщо воно відсутнє, то записується null
        let url = anchor ? anchor.getAttribute('href') : null;

        if (name.length > 0) {
          result.push({
            name,
            url,
          });
        }
      });

      // Прибираємо з ланцюга "Головну" та назву товару
      const h1Text = document
        .querySelector('h1')
        ?.innerText?.trim()
        ?.toLowerCase();

      return result.filter((entry, index) => {
        const lowerName = entry.name.toLowerCase();

        const isHome = ['home', 'main', 'shop', 'catalog'].includes(lowerName);

        const isCurrentProduct =
          index === result.length - 1 && lowerName === h1Text;

        return !isHome && !isCurrentProduct;
      });
    });

    if (!breadcrumbs || breadcrumbs.length === 0) return [];

    // Перетворення відносних шляхів в абсолютні
    const baseCleanUrl = new URL(page.url());

    return breadcrumbs.map((entry) => {
      if (entry.url) {
        try {
          entry.url = new URL(entry.url, baseCleanUrl.origin).href;
        } catch (e) {
          entry.url = null;
        }
      }
      return entry;
    });
  } catch (e) {
    return e;
  }
};

// Допоміжна функція для очищення тексту від пробілів, табів пустих рядків
const cleanText = (text) => {
  if (!text) return null;
  return text
    .replace(/[\t\r]/g, '') // Видаляє таби
    .replace(/\n\s*\n/g, '\n') // об'єднує пусті строки в одну
    .trim();
};

// Допоміжна функція для рекурсивного пошуку ключа "description" в об'єкті Schema.org
const findDesc = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.description) return obj.description;
  for (const key in obj) {
    const result = findDesc(obj[key]);
    if (result) return result;
  }
  return null;
};

const getProductDescription = async (page) => {
  try {
    const descriptionData = await page.evaluate(() => {
      // Шукає в мікро розмітці JSON-LD (Найчистіший опис без розмітки)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const desc = findDesc(json);

          if (desc) return {text: cleanText(desc), source: 'json-ld'};
        } catch (e) {}
      }

      // Шукає SEO (itemprop) за стандартним семантичним атрибутом
      const itempropDesc = document.querySelector('[itemprop="description"]');
      if (itempropDesc) {
        // Якщо це мета-тег, бере content, якщо блок — innerText
        const text =
          itempropDesc.tagName === 'META'
            ? itempropDesc.getAttribute('content')
            : itempropDesc.innerText;

        if (text?.trim()) return {text: cleanText(text), source: 'itemprop'};
      }

      // Шукає в мета-тегах сторінки (Open Graph / SEO-summary)
      const metaDesc =
        document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute('content') ||
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute('content');

      if (metaDesc && metaDesc.trim()) {
        return {text: cleanText(metaDesc), source: 'meta'};
      }

      // Шукає за розповсюдженими CSS-селекторами e-commerce платформ
      const selectors = [
        '.product-description',
        '.product-single__description',
        '#tab-description',
        '.product-meta__description',
        '.shop-description',
        '.description-content',
        '#description',
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          // Перед тим я забрати текст, клонує елемент та видаляє з нього приховані блоки/скрипти
          const clone = element.cloneNode(true);
          const toRemove = clone.querySelectorAll(
            'script, style, .hidden, [style*="display: none"]',
          );
          toRemove.forEach((el) => el.remove());

          if (clone.innerText?.trim()) {
            return {text: cleanText(clone.innerText), source: 'css-selector'};
          }
        }
      }

      return null;
    });

    return descriptionData ? descriptionData.text : null;
  } catch (e) {
    return e;
  }
};

const findPrice = (obj) => {
  if (!obj || typeof obj !== 'object') return null;

  // Шукає стандартні поля Schema.org для цін
  if (obj.price || obj.priceSpecification?.price) {
    return obj.price || obj.priceSpecification.price;
  }

  for (const key in obj) {
    const result = findPrice(obj[key]);
    if (result) return result;
  }

  return null;
};

const getRegularPrice = async (page) => {
  try {
    const rawPriceText = await page.evaluate(() => {
      // Шукає ціну в мікро розмітці JSON-LD
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const price = findPrice(json);
          if (price) return String(price);
        } catch (e) {}
      }

      // Шукає за стандартним семантичним атрибутом itemprop="price"
      const itempropPrice = document.querySelector('[itemprop="price"]');
      if (itempropPrice) {
        return itempropPrice.getAttribute('content') || itempropPrice.innerText;
      }

      // Шукає за спцифічними CSS-класами регулярної ціни (ігнорує ціни знижки)
      const selectors = [
        '.product-card__price--regular',
        '.price--old',
        '.compare-at-price',
        '.original-price',
        '.product-single__price:not(.on-sale)',
        '.main-price',
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) return element.innerText.trim();
      }

      // Фолбек бере перший блок ціни, якщо на ньому немає знижки
      const defaultPriceSelector = document.querySelector(
        '.price, .product-price',
      );
      return defaultPriceSelector
        ? defaultPriceSelector.innerText.trim()
        : null;
    });

    if (!rawPriceText) return null;

    // Очищення рядка та конвертація число (Number) на боці Node.js
    // Видаляє всі пробіли, валютні символи, лише числа, крапки та коми
    let cleaned = rawPriceText.replace(/[^\d.,]/g, '');

    // Якщо ціна у форматі з комою для копійок, замінює її на крапку але з підстраховкою від формату тисч з комою
    if (cleaned.includes(',') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, ''); // Видаляє кому - розділювач тисяч
    } else if (cleaned.includes(',') && !cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, '.'); // Замінює кому копійок на крапку
    }

    const finalPrice = parseFloat(cleaned);

    return isNaN(finalPrice) ? null : finalPrice;
  } catch (e) {
    return e;
  }
};

// Рекурсивний пошук об'єкта Offer з ціною знижки
const findSalePrice = (obj) => {
  if (!obj || typeof obj !== 'object') return null;

  // Якщо в розмітці вказано декілька цін (нприклад: стара та нова в масиві specification)
  if (obj.priceType === 'SalePrice' && obj.price) return obj.price;
  // Деякі CMS включають поточну ціну знижки в стандартне поле price, але додають ознаку акції (наприклад: lowPrice)
  if (obj.offers?.lowPrice) return obj.offers.lowPrice;
  if (
    obj.offers?.price &&
    document.querySelector('.price--old, .compare-at-price')
  ) {
    // Якщо на сторінці візуально є стара ціна - це означає що в JSON-LD — ціна знижки
    return obj.offers.price;
  }

  for (const key in obj) {
    const result = findSalePrice(obj[key]);
    if (result) return result;
  }

  return null;
};

const getSalePrice = async (page) => {
  try {
    // Забирає текст ціни зі знижкою з HTML або JSON-LD
    const rawSalePriceText = await page.evaluate(() => {
      // Перевіряє мікро розмітку JSON-LD. Якщо на сайті є знижка, в блоці Offers часто присутні поля price та priceValidUntil
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const salePrice = findSalePrice(json);

          if (salePrice) return String(salePrice);
        } catch (e) {}
      }

      // Шукає за специфічними CSS-селекторами ціни знижки/акційної ціни
      const saleSelectors = [
        '.product-card__price--sale',
        '.price--sale',
        '.special-price',
        '.sale-price',
        '.current-price.on-sale',
        '.ins-product-price-sale',
      ];

      for (const selector of saleSelectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) return element.innerText.trim();
      }

      // Сувора перевірка візуального контексту (Підстраховка)
      // Якщо на сайті використовується один клас для ціни (.price), але при цьому поруч з'являеться блок старої перекресленої ціни — означає що елемент .price зараз є знижкою
      const hasOldPrice = document.querySelector(
        '.price--old, .compare-at-price, .original-price, del',
      );

      if (hasOldPrice) {
        const currentPriceEl = document.querySelector(
          '.price, .product-price, .main-price',
        );
        if (currentPriceEl?.innerText?.trim())
          return currentPriceEl.innerText.trim();
      }

      return null;
    });

    if (!rawSalePriceText) return null;

    // Очищення рядка та конвертація в число (Number) на боці Node.js
    let cleaned = rawSalePriceText.replace(/[^\d.,]/g, '');

    // Нормалізація формату: перетвоює кому-розділювач копійок на крапку
    if (cleaned.includes(',') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, '');
    } else if (cleaned.includes(',') && !cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, '.');
    }

    const finalSalePrice = parseFloat(cleaned);

    return isNaN(finalSalePrice) ? null : finalSalePrice;
  } catch (e) {
    return e;
  }
};

const findAvailability = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  // Schema.org использует поле availability со стандартными URL-ссылками
  if (obj.availability && typeof obj.availability === 'string') {
    return obj.availability;
  }

  for (const key in obj) {
    const result = findAvailability(obj[key]);
    if (result) return result;
  }

  return null;
};

const getProductAvailability = async (page) => {
  try {
    // Виконує код в середині контексту браузера для анализа DOM та JSON-LD
    const status = await page.evaluate(() => {
      // Перевірка мікро розмітки JSON-LD (Най надійніший спосіб)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const availabilityUrl = findAvailability(json);

          if (availabilityUrl) {
            if (availabilityUrl.includes('InStock')) return 'in_stock';
            if (availabilityUrl.includes('OutOfStock')) return 'out_of_stock';
            if (availabilityUrl.includes('PreOrder')) return 'pre_order';
          }
        } catch (e) {}
      }

      // Перевірка стану головної кнопки дії (CTA)
      const ctaButton = document.querySelector(
        '.product-card__button, .add-to-cart, #add-to-cart, .btn-buy',
      );

      if (ctaButton) {
        const ctaText = ctaButton.innerText.toLowerCase();

        if (
          ctaButton.hasAttribute('disabled') ||
          ctaText.includes('out') ||
          ctaText.includes('нет в наличии') ||
          ctaText.includes('sold out')
        ) {
          return 'out_of_stock';
        }

        if (ctaText.includes('pre-order') || ctaText.includes('предзаказ')) {
          return 'pre_order';
        }
      }

      // Пошук за текстовими маркерами та CSS-класами на сторінці
      const selectors = [
        '.product-stock-status',
        '.stock',
        '.availability',
        '.product-card__badge',
        '.instock',
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.innerText.toLowerCase();

          if (
            text.includes('in stock') ||
            text.includes('в наличии') ||
            text.includes('available')
          )
            return 'in_stock';

          if (
            text.includes('out of stock') ||
            text.includes('нет в наличии') ||
            text.includes('out') ||
            text.includes('закончился')
          )
            return 'out_of_stock';

          if (
            text.includes('pre-order') ||
            text.includes('предзаказ') ||
            text.includes('preorder')
          )
            return 'pre_order';
        }
      }

      // Контекстна підстановка: якщо кнопка купівлі активна і явних маркерів відсутності немає, вважається, що товар у наявності
      if (ctaButton && !ctaButton.hasAttribute('disabled')) {
        return 'in_stock';
      }

      return null;
    });

    return status;
  } catch (e) {
    return e;
  }
};

const findImage = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  // За специфікацією Schema.org, поле може називатись image або primaryImageOfPage
  if (obj.image) {
    if (typeof obj.image === 'string') return obj.image;
    if (Array.isArray(obj.image) && obj.image[0]) return obj.image[0];
    if (typeof obj.image === 'object' && obj.image.url) return obj.image.url;
  }

  for (const key in obj) {
    const result = findImage(obj[key]);
    if (result) return result;
  }

  return null;
};

const getMainProductImage = async (page) => {
  try {
    // Отримує сире посилання на картинку з різних джерел в середині DOM
    const rawImageSrc = await page.evaluate(() => {
      // Шукає в мікро розмітці JSON-LD (най надійніше джерело оригіналу)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const imgUrl = findImage(json);

          if (imgUrl) return imgUrl;
        } catch (e) {}
      }

      // Шукає за стандартним семантичним атрибутом itemprop="image"
      const itempropImg = document.querySelector(
        '[itemprop="image"], img[itemprop="image"]',
      );

      if (itempropImg) {
        return (
          itempropImg.getAttribute('src') ||
          itempropImg.getAttribute('data-src') ||
          itempropImg.getAttribute('content')
        );
      }

      // Шукає в мета-тегах Open Graph (Тег, який формує перші посилання для соц мереж)
      const ogImg = document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content');

      if (ogImg && ogImg.trim()) return ogImg.trim();

      // Шукає за розповсюдженими селекторами галерей e-commerce платформ
      const gallerySelectors = [
        '.product-featured-image', // Популярний селектор Shopify/кастомних преміум-тем
        '.product-single__photo img',
        '#main-product-image',
        '.product-main-image img',
        '.gallery__main img',
        '.product-card__img',
      ];

      for (const selector of gallerySelectors) {
        const element = document.querySelector(selector);
        if (element) {
          // Перевіряє ліниве завантаження (lazy loading), часто реальне посилання лежить в data-атрибутах
          return (
            element.getAttribute('data-zoom-image') ||
            element.getAttribute('data-src') ||
            element.getAttribute('src')
          );
        }
      }

      // Якщо специфічних блоків немає, бере першу велику картинку в тегу <main>
      const mainContent = document.querySelector('main');

      if (mainContent) {
        const allImages = Array.from(mainContent.querySelectorAll('img'));
        // Відфільтровує занадто маленькі картинки (іконки, стрілки)
        const productImg = allImages.find((img) => {
          const width =
            img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);

          return width > 150 || !img.src.includes('icon');
        });

        if (productImg) return productImg.src;
      }

      return null;
    });

    if (!rawImageSrc) return null;

    // Претворює відносний шлях в абсолютний URL
    const baseCleanUrl = new URL(page.url());
    const absoluteImageUrl = new URL(rawImageSrc, baseCleanUrl.origin).href;

    return absoluteImageUrl;
  } catch (e) {
    return e;
  }
};

const searchImages = (obj) => {
  if (!obj || typeof obj !== 'object') return;
  if (obj.image) {
    if (Array.isArray(obj.image)) {
      obj.image.forEach((img) =>
        foundSrcs.push(typeof img === 'object' ? img.url : img),
      );
    } else if (typeof obj.image === 'object' && obj.image.url) {
      foundSrcs.push(obj.image.url);
    }
  }

  for (const key in obj) {
    searchImages(obj[key]);
  }
};

const getAdditionalImages = async (page) => {
  try {
    // Збирає всі посилання на зображення галереї з DOM та JSON-LD
    const rawImages = await page.evaluate(() => {
      const foundSrcs = [];

      // Шукає в мікро розмітці JSON-LD (Якщо картинок декілька, вони йдуть масивом в поле image)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          searchImages(json);
        } catch (e) {}
      }

      // Шукає за стандартними CSS-селекторами галерей/мініатюр (Thumbnails)
      const thumbSelectors = [
        '.product-single__thumbnail img',
        '.product-gallery__image img',
        '.gallery__thumbnail img',
        '.product-thumb img',
        '[class*="thumb"] img',
        '.product-card__gallery-item img', // Варіант для кастомних галерей
      ];

      thumbSelectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);

        elements.forEach((el) => {
          // Забирає посилання з оригінальних атрибутів або lazy-load параметрів
          const src =
            el.getAttribute('data-zoom') ||
            el.getAttribute('data-src') ||
            el.getAttribute('src');
          if (src) foundSrcs.push(src);
        });
      });

      // Якщо спеціальних класів немає, шукає будь які картинки в середині контейнера галереї
      const galleryWrapper = document.querySelector(
        '.product-images, .gallery, #product-gallery, .product-media',
      );

      if (galleryWrapper) {
        const imgs = galleryWrapper.querySelectorAll('img');

        imgs.forEach((img) => {
          const src = img.getAttribute('data-src') || img.src;
          if (src) foundSrcs.push(src);
        });
      }

      return foundSrcs;
    });

    if (!rawImages || rawImages.length === 0) return [];

    // Претворює відносний шлях в абсолютний URL (Node.js)
    const baseCleanUrl = new URL(page.url());
    const absoluteUrls = rawImages
      .map((src) => {
        try {
          return new URL(src, baseCleanUrl.origin).href;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    // Фіналізація (Виключає дублікати та сміття)
    const uniqueImagesSet = new Set();

    absoluteUrls.forEach((url) => {
      const lowerUrl = url.toLowerCase();

      // Відтинає іконки, логотипи та дрібні елементи інтерфейсу
      const isTrash =
        lowerUrl.includes('icon') ||
        lowerUrl.includes('logo') ||
        lowerUrl.includes('arrow') ||
        lowerUrl.includes('placeholder');

      // Виключає головне зображення, якщо воно передане аргументом у функцію
      const isMainDuplicate = mainImageUrl && url === mainImageUrl;

      if (!isTrash && !isMainDuplicate) {
        // Очищує URL від динамічних параметрів розмірів (наприклад: watch_100x100.jpg -> watch.jpg)
        // Не рідко CMS накшталт Shopify створюють дублікати через різні query-параметри (?v=123 або &width=50)
        const cleanUrl = url.split('?')[0];
        uniqueImagesSet.add(cleanUrl);
      }
    });

    return Array.from(uniqueImagesSet);
  } catch (e) {
    return e;
  }
};

// Очищує текст від сміттєвих символів
const cleanStr = (str) => {
  if (!str) return '';
  return str
    .replace(/[\n\t\r]/g, ' ') // Прибирає переноси і таби
    .replace(/^[:\s\-•]+|[:\s\-•]+$/g, '') // Прибирає двокрапку, дефіси та крапки на краях
    .replace(/\s+/g, ' ') // Прибирає множинні пробіли
    .trim();
};

const getTechnicalSpecifications = async (page) => {
  // Виконує код в середині контексту браузера для збору даних з DOM
  const specs = await page.evaluate(() => {
    const result = [];

    // Збір з класичних таблиць (<table>): шукає таблиці в середині табів, характеристик чи блоків з відповідними класами
    const tables = document.querySelectorAll(
      '.product-specs, .technical-specs, #specs-table, .specification table, main table',
    );

    tables.forEach((table) => {
      const rows = table.querySelectorAll('tr');

      rows.forEach((row) => {
        // Шукає комірку-заголовок (th чи перший td) та комірку-значення (останній td)
        const cells = row.querySelectorAll('th, td');

        if (cells.length >= 2) {
          const key = cleanStr(cells[0].innerText || cells[0].textContent);
          const value = cleanStr(
            cells[cells.length - 1].innerText ||
              cells[cells.length - 1].textContent,
          );

          // Записує в об'єкт, якщо ключ не пустий і це не заголовок секції таблиці
          if (key && value && key !== value) {
            result.push(`${key}:${value}`);
          }
        }
      });
    });

    // Збір зі списків описів (<dl>, <dt>, <dd>) ---
    const dlLists = document.querySelectorAll('dl');

    dlLists.forEach((dl) => {
      const dts = dl.querySelectorAll('dt');

      dts.forEach((dt) => {
        const dd = dt.nextElementSibling;

        if (dd && dd.tagName === 'DD') {
          const key = cleanStr(dt.innerText);
          const value = cleanStr(dd.innerText);

          if (key && value) result.push(`${key}:${value}`);
        }
      });
    });

    // Збір з маркованих списків (<ul> / <li>) з розділювачем "двокрапка"
    const specLists = document.querySelectorAll(
      '.specs-list, .attributes, .product-features, main ul',
    );

    specLists.forEach((list) => {
      const items = list.querySelectorAll('li');

      items.forEach((item) => {
        const text = item.innerText || item.textContent;
        // Перевіряє чи є в рядку двокрапка, що розділює ключ та значення
        if (text && text.includes(':')) {
          const parts = text.split(':');
          const key = cleanStr(parts[0]);
          // З'єднує частини що залишились на випадок, якщо в значенні теж були двокрапки (наприклад: в таймстампі)
          const value = cleanStr(parts.slice(1).join(':'));

          if (key && value && key.length < 50) {
            // Обмеження довжини ключа, щоб не захопити цілий абзац тексту
            result.push(`${key}:${value}`);
          }
        }
      });
    });

    return Object.keys(result).length > 0 ? result : null;
  });

  return specs;
};

const findRating = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  // Шукає стандартні поля Schema.org: AggregateRating -> ratingValue
  if (obj['@type'] === 'AggregateRating' && obj.ratingValue)
    return obj.ratingValue;
  if (obj.aggregateRating?.ratingValue) return obj.aggregateRating.ratingValue;

  for (const key in obj) {
    const result = findRating(obj[key]);

    if (result) return result;
  }

  return null;
};

const getStarRating = async (page) => {
  try {
    // Отримує сирі дані рейтинга з DOM чи JSON-LD в середині браузера
    const rawRating = await page.evaluate(() => {
      // Шукає в мікро розмітці JSON-LD (Най точніший та незалежний від дизайну спосіб)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const rating = findRating(json);
          if (rating) return String(rating);
        } catch (e) {}
      }

      // Шукає по стандартному семантичному атрибуту itemprop="ratingValue"
      const itempropRating = document.querySelector('[itemprop="ratingValue"]');
      if (itempropRating) {
        return (
          itempropRating.getAttribute('content') || itempropRating.innerText
        );
      }

      // Шукає за поширеними CSS-селекторами e-commerce платформ
      const ratingSelectors = [
        '.product-card__rating-value',
        '.rating-number',
        '.average-rating',
        '.score',
        '[class*="rating"] .value',
        '.review-rating',
      ];

      for (const selector of ratingSelectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) {
          const text = element.innerText.trim();
          // Страховка від текстів типу "Оцінка: 4.8" чи "4.8 з 5"
          if (/[1-5][.,]\d|5/.test(text)) return text;
        }
      }

      // Просунутий UX-фолбек (Парсинг процентів заповнення зврок зі стилів CSS)
      // Часто в темах зірковий рейтинг візуалізується через ширину блока: style="width: 90%"
      const fillStars = document.querySelector(
        '.stars-fill, .rating-stars__active, [style*="width"]',
      );

      if (fillStars) {
        const widthStyle = fillStars.getAttribute('style');
        const match = widthStyle?.match(/width\s*:\s*(\d+(?:\.\d+)?)(?:px|%)/i);

        if (match) {
          const percentage = parseFloat(match[1]);
          // Якщо ширина в процентах (наприклад: 90%), переводить у 5-зіркову шкалу (90 * 5 / 100 = 4.5)
          if (widthStyle.includes('%') && percentage <= 100) {
            return String((percentage * 5) / 100);
          }
        }
      }

      return null;
    });

    if (!rawRating) return null;

    // Обробка та нормалізація рядка в число на боці Node.js та заміна коми на крапку (на випадок формату "4,7")
    let cleaned = rawRating.replace(/,/g, '.');

    // Забирає тільки першу групу чисел з перемінною крапкою (наприклад: з строки "4.7 out of 5" забирає "4.7")
    const match = cleaned.match(/([1-5](?:\.\d+)?)/);

    if (!match) return null;

    const finalRating = parseFloat(match[1]);

    // Валідація: рейтинг в e-commerce не може бути більший за 5 чи менший за 0
    return !isNaN(finalRating) && finalRating >= 0 && finalRating <= 5
      ? finalRating
      : null;
  } catch (e) {
    return e;
  }
};

const findReviewCount = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  // Шукає стандартні поля Schema.org: AggregateRating -> reviewCount
  if (obj['@type'] === 'AggregateRating' && obj.reviewCount)
    return obj.reviewCount;
  if (obj.aggregateRating?.reviewCount) return obj.aggregateRating.reviewCount;

  for (const key in obj) {
    const result = findReviewCount(obj[key]);

    if (result) return result;
  }

  return null;
};

const getReviewCount = async (page) => {
  try {
    // Забирає сирий текст чи число кількості відгуків з DOM / JSON-LD
    const rawCountText = await page.evaluate(() => {
      // Перевіряє мікро розмітку JSON-LD (Най надійніше та чисте джерело)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const count = findReviewCount(json);
          if (count) return String(count);
        } catch (e) {}
      }

      // Шукає за стандартним семантичним атрибутом itemprop="reviewCount"
      const itempropReview = document.querySelector('[itemprop="reviewCount"]');

      if (itempropReview) {
        return (
          itempropReview.getAttribute('content') || itempropReview.innerText
        );
      }

      // Шукає за поширеними класами свідгуків в e-commerce
      const reviewSelectors = [
        '.product-card__review-count',
        '.review-count',
        '.reviews-total',
        '.rating-link',
        '#reviews-tab-trigger',
        '.comments-count',
        '.product-meta__reviews-count',
      ];

      for (const selector of reviewSelectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) {
          const text = element.innerText.trim();
          // Перевіряє наявність чисел у рядку, щоб прибрати текст накшталт "Написати відгук"
          if (/\d/.test(text)) return text;
        }
      }

      // Текстовий пошук по всій сторінці (якщо блоки специфічно названі), шукає елементи, текст яких включає слово "review" та числа
      const allLinksAndSpans = document.querySelectorAll('a, span, button');

      for (const el of allLinksAndSpans) {
        const text = el.innerText;
        if (/\d+/.test(text) && /(review|rating|comment)/i.test(text)) {
          return text;
        }
      }

      return null;
    });

    if (!rawCountText) return null;

    // Очистка рядка та конвертація в ціле число (Integer) на боці Node.js, видаляє все, крім чисел (видаляє дужки, букви, пробіли)
    const cleaned = rawCountText.replace(/[^\d]/g, '');

    const finalCount = parseInt(cleaned, 10);

    // Возвращаем число, если парсинг успешен, иначе 0
    return !finalCount ? null : finalCount;
  } catch (e) {
    return e;
  }
};

// Рекурсивна функція для пошуку стандартних полівщтрих кодів в Schema.org
const findGtinField = (obj) => {
  if (!obj || typeof obj !== 'object') return null;

  // Проверяем все стандартные спецификации штрихкодов
  if (obj.gtin) return obj.gtin;
  if (obj.gtin8) return obj.gtin8;
  if (obj.gtin12) return obj.gtin12;
  if (obj.gtin13) return obj.gtin13;
  if (obj.gtin14) return obj.gtin14;
  if (obj.upc) return obj.upc;
  if (obj.mpn) return obj.mpn; // Иногда дублируют туда
  if (obj.isbn) return obj.isbn; // Для книг

  for (const key in obj) {
    const result = findGtinField(obj[key]);

    if (result) return result;
  }

  return null;
};

const getGtin = async (page) => {
  try {
    const rawGtin = await page.evaluate(() => {
      // Шукає в глобальних об'єктах надих (Page Data / Window)
      // Сучасні CMS часто зберігають повні мета-дані в window.product, window.__NEXT_DATA__ і т.д.
      const idFromWindow =
        window?.productData?.gtin ||
        window?.productData?.upc ||
        window?.productData?.ean ||
        window?.shopifyFeatures?.status || // Для Shopify
        null;

      if (idFromWindow) return String(idFromWindow);

      // Шукає в мікро розмітці JSON-LD (Най надійніше джерело для Google Merchant)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const gtinValue = findGtinField(json);

          if (gtinValue) return String(gtinValue);
        } catch (e) {}
      }

      // Шукає по семантичним атрибутам itemprop
      const itempropSelectors = [
        '[itemprop="gtin"]',
        '[itemprop="gtin13"]',
        '[itemprop="gtin12"]',
        '[itemprop="upc"]',
        '[itemprop="ean"]',
      ];

      for (const selector of itempropSelectors) {
        const element = document.querySelector(selector);

        if (element) {
          return element.getAttribute('content') || element.innerText;
        }
      }

      // Шукає за поширеними CSS-класами характеристик
      const cssSelectors = [
        '.product-gtin',
        '.product-upc',
        '.product-ean',
        '.barcode-number',
        '[data-gtin]',
        '[data-upc]',
      ];

      for (const selector of cssSelectors) {
        const element = document.querySelector(selector);

        if (element) {
          return (
            element.getAttribute('data-gtin') ||
            element.getAttribute('data-upc') ||
            element.innerText
          );
        }
      }

      // Шукає за текстовим співпадінням в таблицях характеристик: шукає рядки, де написано "GTIN", "UPC"
      const rows = document.querySelectorAll('tr, li, p');

      for (const row of rows) {
        const text = row.innerText;
        if (/(gtin|upc|ean|barcode)/i.test(text)) {
          return text;
        }
      }

      return null;
    });

    if (!rawGtin) return null;

    // Очищення рядка на боці Node.js: видаляє все за винятком чисел та букв (на випадок якщо код містить префікси)
    // Більшість кодів GTIN/UPC складаються суворо з 8, 12, 13 чи 14 чисел
    let cleaned = rawGtin.replace(/[^a-zA-Z0-9]/g, '');

    // Видаляє текстові маркери, якщо вони потрапили під час текстового пошуку (наприклад: "Штрихкод: 123456" -> "123456")
    cleaned = cleaned.replace(/(gtin|upc|ean|barcode|штрихкод|штрихкод)/gi, '');

    return cleaned.trim().length > 0 ? cleaned.trim() : null;
  } catch (e) {
    return e;
  }
};

// Рекурсивний пошук стандартного MPN в Schema.org
const findMpnField = (obj) => {
  if (!obj || typeof obj !== 'object') return null;

  if (obj.mpn) return obj.mpn;
  if (obj.model) {
    // Іноді розробники записують MPN в поле моделі
    return typeof obj.model === 'object' ? obj.model.name : obj.model;
  }

  for (const key in obj) {
    const result = findMpnField(obj[key]);
    if (result) return result;
  }

  return null;
};

const getMpn = async (page) => {
  try {
    const rawMpn = await page.evaluate(() => {
      // Шукає в глобальних об'єктах даних (Page Data / Window) ===
      const idFromWindow =
        window?.productData?.mpn ||
        window?.productData?.partNumber ||
        window?.shopifyFeatures?.mpnStatus ||
        null;

      if (idFromWindow) return String(idFromWindow);

      // Шукає в мікро розмітці JSON-LD (Schema.org / Product)
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent);
          const mpnValue = findMpnField(json);

          if (mpnValue) return String(mpnValue);
        } catch (e) {}
      }

      // Шукає по семантичним атрибутам itemprop
      const itempropMpn = document.querySelector(
        '[itemprop="mpn"], [itemprop="partNumber"]',
      );

      if (itempropMpn) {
        return itempropMpn.getAttribute('content') || itempropMpn.innerText;
      }

      // Шукає за розповсюдженими CSS-селекторами інтернет-магазинів
      const cssSelectors = [
        '.product-mpn',
        '.part-number',
        '.manufacturer-part-number',
        '[data-mpn]',
        '.sku-number', // На автосайтах SKU та MPN часто дублюють один одного
        '.product-meta__sku',
      ];

      for (const selector of cssSelectors) {
        const element = document.querySelector(selector);

        if (element) {
          return element.getAttribute('data-mpn') || element.innerText;
        }
      }

      // Текстовий пошук по таблиці хорактеристик товарів: шукає рядки, що містять ключове слово накшталт MPN
      const rows = document.querySelectorAll('tr, li, p');

      for (const row of rows) {
        const text = row.innerText;
        if (/(mpn|part number|partnumber)/i.test(text)) {
          return text;
        }
      }

      return null;
    });

    if (!rawMpn) return null;

    // Очищення рядка на боці Node.js
    let cleaned = rawMpn.trim();

    // Якщо потрапив текст з префіксом (наприклад: "Артикул: BOSCH-123"), видаляє маркер
    cleaned = cleaned.replace(/(mpn|part number|partnumber|:|：)/gi, '');

    // Видаляє пробіли по краях, зберігаючи дефіси та спецсимволи артикула
    cleaned = cleaned.replace(/^\s+|\s+$/g, '');

    return cleaned.length > 0 ? cleaned : null;
  } catch (e) {
    return e;
  }
};

const getProductData = async (page, url) => {
  try {
    const productData = {
      url: page.url(),
      item_id: await getProductId(page, url),
      title: await getProductTitle(page),
      brand: await getBrandFromSiteMeta(page),
      product_category: await getProductCategory(page),
      category_tree: await getDetailedBreadcrumbs(page),
      description: await getProductDescription(page),
      price: await getRegularPrice(page),
      sale_price: await getSalePrice(page),
      availability: await getProductAvailability(page),
      image_url: await getMainProductImage(page),
      additional_image_urls: await getAdditionalImages(page),
      specs: await getTechnicalSpecifications(page),
      star_rating: await getStarRating(page),
      review_count: await getReviewCount(page),
      gtin: await getGtin(page),
      mpn: await getMpn(page),
      scraped_at: new Date().toISOString(),
    };

    return await productData;
  } catch (e) {
    return e;
  }
};

const writeProductData = async (
  productData,
  filename = './src/output/product.json',
) => {
  try {
    const jsonString = JSON.stringify(productData, null, 2);
    await fs.writeFile(filename, jsonString, (data, error) =>
      data ? data : error,
    );

    console.log(`Дані успішно записані в файл: ${filename}`);
  } catch (error) {
    console.error(`Помилка під час запису файла: ${error.message}`);
  }
};

const pageScraper = async (start, getProductData, writeProductData) => {
  try {
    const page = await start(TARGET_URL);
    const productData = await getProductData(page, page.url());
    console.log('PgeScraper productData: ', productData);

    if (productData) writeProductData(productData);

    await browser.close();
  } catch (e) {
    throw new Error(e.message);
  }
};

pageScraper(start, getProductData, writeProductData);
