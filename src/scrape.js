const {chromium} = require('playwright');
const fs = require('fs/promises');

const TARGET_URL =
  'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';

// Створює контекст з повним маскуванням під реальний пристрій (емуляція Windows + Chrome)
const handleCreateContext = async (browser) => {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const context = await browser.newContext({
    // Передає User-Agent реального браузера БЕЗ слова "HeadlessChrome"
    userAgent,
    // Задає стандартне розширення дисплея (в headless режимі воно часто буває 0x0, що видає бота)
    viewport: {width: 1920, height: 1080},
    screen: {width: 1920, height: 1080},
    deviceScaleFactor: 1, // Емулує стандартну щільність пікселів монітора
    // Задає локалізацію та часовий пояс (для магазина MSI в США краще New York або Chicago)
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Вставляє заголовки, які Cloudflare очікує побачити від реального Chrome 124
    extraHTTPHeaders: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua':
        '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Me-Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site', // Вказує, що ми прийшли зі стороннього сайту (з пошуку)
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1', // Емулює, що ми перейшли на MSI за посиланням з пошуковика DuckDuckGo
      Referer: 'https://duckduckgo.com',
    },
    // Дозволяє базові функції браузера
    acceptDownloads: true,
  });

  // Скрипт очистки DOM-параметрів (виконується перед завантаженням будь-яких скриптів Cloudflare)
  await context.addInitScript(() => {
    // Вставляє скрипт, який прибирає флаг navigator.webdriver перед завантаженням сайту
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    // Імітує реальну відеокарту (Cloudflare перевіряє WebGL фейкових headless-відеокарт)
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel(R) Iris(R) Xe Graphics'; // UNMASKED_RENDERER_WEBGL
      return getParameter.apply(this, arguments);
    };
    // Налаштування мов та плагінів
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          name: 'Chromium PDF Viewer',
        },
      ],
    });
  });

  return context;
};

const handleCookieBanner = async (page) => {
  try {
    console.log('Cookie banner presence check...');

    // Шукає кнопку Accept за текстом в середині банера чи за специфічними селекторами e-commerce платформ
    // Playwright locator('text=...') ідеально підходить для текстових кнопок без стабільних ID
    const acceptButton = page
      .locator(
        [
          '#btn-cookie-allow', // Поширений ID в Magento/Adobe Commerce
          '.cookie-status-block button',
          'button:has-text("Accept")', // Пошук за суворим входженням тексту
          'a:has-text("Accept")',
        ].join(', '),
      )
      .first(); // Якщо селекторів декілька, бере перший що співпав

    // Чекає на появу банера максимум 3 секунди (для того щоб не гальмувати загальний скрапінг)
    await acceptButton.waitFor({state: 'visible', timeout: 3000});

    // Клікає по кнопці
    await acceptButton.click();
    console.log('✅ Cookie banner closed successfully.');

    // Чекає на проховання оверлею, для того щоб він не заважав подальшим клікам по елементах
    await page.waitForTimeout(500);
  } catch (e) {
    // Якщо відбувся таймаут — означає що банер не з'явився (куки уже куки вже прийняті або захист його не відрендерив)
    // В скрапінгу це нормальна поведінка, просто йдем далі
    console.log('ℹ️ Cookie banner not found or was closed, continue scraping.');
  }
};

const start = async (TARGET_URL) => {
  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled', // Приховує більшість флагів автоматизації в Chromium
        '--disable-infobars', // Прибирає рядок "Браузером керує автоматизоване ПО"
        '--disable-canvas-aa', // Маскує відбиток Canvas (Fingerprint)
        '--disable-2d-canvas-clip-aa', // Додатковий захист Canvas
        '--disable-gl-drawing-for-tests', // Приховує тестові сигнатури WebGL
        '--no-sandbox',
      ],
    });

    const context = await handleCreateContext(browser);
    const page = await context.newPage();
    page.on('console', (msg) => {
      console.log(`[Browser] ${msg.text()}`);
    });

    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.includes('google-analytics') ||
        url.includes('googletagmanager') ||
        url.includes('go-mpulse.net') ||
        url.includes('facebook') ||
        url.includes('hotjar') ||
        url.includes('tiktok')
      ) {
        return route.abort(); // Миттєво відміняє сміттєвий запит
      }
      return route.continue(); // Пропускає корисний контент сайту
    });

    console.log('Session heat emulation on DuckDuckGo...');
    // Перед тим як йти на MSI, спочатку заходить на DuckDuckGo, щоб створити природні куки в контексті
    await page.goto('https://duckduckgo.com?q=MSI+MAG+Z890+TOMAHAWK+WIFI', {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(1500); // Коротка пауза людини

    console.log('Going to target MSI page...');
    // Переходить на MSI. Сервер побачить куки, реферер пошуковика та ідеальні заголовки Sec-Ch-Ua
    const response = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log(`Server response status: ${response.status()}`);

    if (response.status() === 403) {
      console.log('❌ Cloudflare continuing to block. Proxi rotation needed.');
      return null;
    }

    await handleCookieBanner(page);

    return {page, browser};
  } catch (e) {
    console.error(`[Error] start failed: ${e.message}`);
    return null;
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

      return metaId || dataId || inputId || skuId || null;
    });
    console.log('Id from html: ', idFromHtml);

    if (idFromHtml) return String(idFromHtml);

    return null;
  } catch (e) {
    console.error(`[Error] getProductId failed: ${e.message}`);
    return null;
  }
};

const getProductTitle = async (page, url) => {
  try {
    // Забирає slug з URL (останній сегмент перед знаком питання)
    // '.../INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI' -> 'MAG-Z890-TOMAHAWK-WIFI'
    const urlSegments = url.split('?')[0].split('/');
    const urlSlug =
      urlSegments[urlSegments.length - 1] ||
      urlSegments[urlSegments.length - 2];

    if (!urlSlug) return null;

    // Нормалізує slug: тільки букви та числа в нижньому регістрі
    // 'MAG-Z890-TOMAHAWK-WIFI' -> 'magz890tomahawkwifi'
    const normalizedUrlSlug = urlSlug.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Визначає зону пошуку. Судячи зі структури MSI, це '.product-info-main'.
    // Але тако ж підводить резервні селектори на випадок, якщо клас зміниться.
    const mainContainerSelector =
      '.product-info-main, .product-view, .product-essential, body';

    // Збирає потенційні елементи заголовка в середині цієї області: h1, h2, та елементи з класами title/name
    const candidatesLocator = page.locator(
      `${mainContainerSelector} h1, ` +
        `${mainContainerSelector} h2, ` +
        `${mainContainerSelector} .page-title, ` +
        `${mainContainerSelector} .product-name`,
    );

    const count = await candidatesLocator.count();

    // Перебирає усих кандидатів
    for (let i = 0; i < count; i++) {
      const text = await candidatesLocator.nth(i).textContent();
      if (!text) continue;

      // Нормалізує текст кандидата
      const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Ідеальне співпадіння: текст текст елемента повністю співпадає зі slug з URL
      if (normalizedText === normalizedUrlSlug) {
        return text.trim();
      }
    }

    // Якщо ідеального співпадіння тегів не було знайдено, робить другу ітерацію:
    // Шукає часткове співпадіння (наприклад: якщо в заголовку написано "MSI MAG Z890 TOMAHAWK WIFI Motherboard")
    for (let i = 0; i < count; i++) {
      const text = await candidatesLocator.nth(i).textContent();
      if (!text) continue;

      const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Виключає загальні слогани та сміття, перевіряє щільне входження
      if (
        normalizedText.includes(normalizedUrlSlug) &&
        !normalizedText.includes('uniteasone')
      ) {
        return text.trim();
      }
    }

    // Фолбек: якщо DOM повністю переписаний, витягає чистий заголовок з мета-тегів
    const metaTitle = await page.evaluate(() => {
      return (
        document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute('content') ||
        document.querySelector('meta[name="title"]')?.getAttribute('content')
      );
    });

    if (metaTitle && metaTitle.trim()) {
      return metaTitle.split(/[|•-]/)[0].trim();
    }

    return null;
  } catch (e) {
    console.error(`[Error] getProductTitle failed: ${e.message}`);
    return null;
  }
};

const getBrandFromSiteMeta = async (page) => {
  try {
    const brandData = await page.evaluate(() => {
      const findBrand = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.brand) {
          if (typeof obj.brand === 'string') return obj.brand;
          if (obj.brand.name) return obj.brand.name;
        }
        if (obj['@graph'] && Array.isArray(obj['@graph'])) {
          for (const item of obj['@graph']) {
            const res = findBrand(item);
            if (res) return res;
          }
        }
        return null;
      };

      // Най надійніше джерело для E-commerce — JSON-LD розмітка (Structured Data)
      // Великі магазини завжди використовують Schema.org, де бренд прописаний явно.
      const jsonLdScripts = document.querySelectorAll(
        'script[type="application/ld+json"]',
      );
      for (const script of jsonLdScripts) {
        try {
          const json = JSON.parse(script.textContent || '{}');
          // Шукає в середині @graph або в корні об'єкта Product
          const brandName = findBrand(json);
          if (brandName) return brandName.trim();
        } catch (e) {
          // Ігнорує помилки парсингу "битого" JSON на сторінці
        }
      }

      // Шувкає за спеціальним мета-тегом product:brand
      const productBrand =
        document.querySelector('meta[name="product:brand"]') ||
        document.querySelector('meta[property="product:brand"]');
      if (productBrand?.getAttribute('content')) {
        return productBrand.getAttribute('content').trim();
      }

      const siteName = document
        .querySelector('meta[property="og:site_name"]')
        ?.getAttribute('content');
      if (siteName) return siteName.trim();

      // Аналіз document.title
      const pageTitle = document.title;
      if (pageTitle) {
        return pageTitle.trim();
      }

      return null;
    });

    if (!brandData) return null;

    // Очищує рядок від сміттєвих комерційних суфіксів интернет-магазинів
    // Наприклад: "MSI US Store" -> "MSI", "ASUS Official Store" -> "ASUS"
    let cleanBrand = brandData
      .replace(/\b(Official|Store|Shop|US|Global|Europe|Online|Store)\b/gi, '') // Прибирає маркет-слова
      .replace(/[^a-zA-Z0-9\s]/g, '') // Прибирає лишні дефіси та галочки
      .trim();

    // Якщо після очистки залишився пустий рядок або сміття, робить жорсткий фолбек під MSI
    if (!cleanBrand || cleanBrand.length < 2) {
      const currentUrl = page.url().toLowerCase();
      if (currentUrl.includes('msi.com')) return 'MSI';
    }

    // Повертає перше слово (зазвичай це сам бренд, наприклад: "MSI" з "MSI Computer")
    return cleanBrand ? cleanBrand.split(/\s+/)[0] : 'MSI';
  } catch (e) {
    console.error(`[Error] getBrandFromSiteMeta failed: ${e.message}`);
    return null;
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

      // Видаляє елементи що повторюються через Set
      const uniqueCategories = [...new Set(categories)];

      // Видаляє назву самого товару в кінці,
      // якщо вона потрапила в масив (категорія — це шлях до товару)
      const lastItem =
        uniqueCategories[uniqueCategories.length - 1].toLowerCase();
      if (
        lastItem.includes('z890') ||
        lastItem.includes('tomahawk') ||
        lastItem.includes('wifi')
      ) {
        uniqueCategories.pop();
      }

      // Зклеює масив в рядок через " > "
      return uniqueCategories.join(' > ');
    });

    return categoryData;
  } catch (e) {
    console.error(`[Error] getProductCategory failed: ${e.message}`);
    return null;
  }
};

const getDetailedBreadcrumbs = async (page) => {
  try {
    const breadcrumbs = await page.evaluate(() => {
      const container = document.querySelector(
        '.breadcrumbs, .breadcrumb, [class*="breadcrumb"], nav[aria-label="Breadcrumb"]',
      );

      if (!container) return [];

      // Обирає суворо елементи списку (li),
      // щоб уникнути подвійного збору (спочатку li, потім вкладеного a)
      const items = Array.from(
        container.querySelectorAll('li, [class*="item"]:not(a)'),
      );

      const result = [];

      items.forEach((item) => {
        const anchor = item.tagName === 'A' ? item : item.querySelector('a');

        let name = item.innerText
          ? item.innerText.replace(/[\n\t\/\>]/g, '').trim()
          : '';

        let url = anchor ? anchor.getAttribute('href') : null;

        if (name.length > 0) {
          result.push({
            name,
            url,
          });
        }
      });

      // Фільтрує масив, залишаючи тільки перші унікальні імена
      // (це вирішує проблему прихованої мобільної розмітки MSI)
      const uniqueResults = result.filter(
        (entry, index, self) =>
          index === self.findIndex((t) => t.name === entry.name),
      );

      // Так як h1 у MSI часто містить слогани,
      // перевіряє поточний товар за характерним ключовим словом з URL або за наявністю null в URL
      return uniqueResults.filter((entry, index) => {
        const lowerName = entry.name.toLowerCase();

        const isHome = ['home', 'main', 'shop', 'catalog'].includes(lowerName);

        // Якщо це останній елемент ланцюга і у нього немає посилання, або він містить маркери плати — це сам товар
        const isCurrentProduct =
          index === uniqueResults.length - 1 &&
          (!entry.url ||
            lowerName.includes('z890') ||
            lowerName.includes('tomahawk'));

        return !isHome && !isCurrentProduct;
      });
    });

    if (!breadcrumbs || breadcrumbs.length === 0) return [];

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
    console.error(`[Error] getDetailedBreadcrumbs failed: ${e.message}`);
    return [];
  }
};

const getProductDescription = async (page) => {
  try {
    const descriptionData = await page.evaluate(() => {
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

      // Шукає за розповсюдженими CSS-селекторами e-commerce платформ
      const selectors = [
        '#description-list',
        '#tab-description',
        '#description',
        '.product-description',
        '.product-single__description',
        '.product-meta__description',
        '.shop-description',
        '.description-content',
        '.product-description-list',
        '.description-list',
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);

        if (element) {
          // Перед тим як забрати текст, клонує елемент та видаляє з нього приховані блоки/скрипти
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

      return null;
    });

    return descriptionData ? descriptionData.text : null;
  } catch (e) {
    return e;
  }
};

const getRegularPrice = async (page) => {
  try {
    const rawPriceText = await page.evaluate(() => {
      // Обробляє findPrice в середині evaluate, щоб браузер її бачив
      const findPrice = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        // В JSON-LD регулярна ціна за наявності знижок часто записується як highPrice
        if (obj.highPrice) return obj.highPrice;
        if (obj.price && !obj.priceType) return obj.price;

        for (const key in obj) {
          const result = findPrice(obj[key]);
          if (result) return result;
        }
        return null;
      };

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
        '#prices-old',
        '[data-price-type="oldPrice"] .price',
        '.price-box .old-price .price',
        '[data-price-type="finalPrice"] .price',
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

      const fallbackSelectors = ['#prices-new', '.price, .product-price'];

      // Фолбек повертає ціну, якщо немає знижки
      for (const selector of fallbackSelectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) return element.innerText.trim();
      }

      return null;
    });

    if (!rawPriceText) return null;

    // Очищення рядка та конвертація число (Number) на боці Node.js
    let cleaned = rawPriceText.replace(/[^\d.,]/g, '');

    if (cleaned.includes(',') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, '');
    } else if (cleaned.includes(',') && !cleaned.includes('.')) {
      cleaned = cleaned.replace(/,/g, '.');
    }

    const finalPrice = parseFloat(cleaned);

    return isNaN(finalPrice) ? null : finalPrice;
  } catch (e) {
    console.error(`[Error] getRegularPrice failed: ${e.message}`);
    return null;
  }
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
        '.price--old, .compare-at-price, .original-price, del, #prices-old',
      );

      if (hasOldPrice) {
        const currentPriceEl = document.querySelector(
          '.price, .product-price, .main-price, #prices-new',
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

const getProductAvailability = async (page) => {
  try {
    // Виконує код в середині контексту браузера для анализа DOM та JSON-LD
    const status = await page.evaluate(() => {
      // Допоміжна функція - шукає наявні співпадіння в мікро розмітці
      const findAvailability = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.availability && typeof obj.availability === 'string')
          return obj.availability;
        if (obj.offers) {
          if (Array.isArray(obj.offers) && obj.offers[0]?.availability)
            return obj.offers[0].availability;
          if (obj.offers.availability) return obj.offers.availability;
        }
        for (const key in obj) {
          const result = findAvailability(obj[key]);
          if (result) return result;
        }
        return null;
      };

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
        '#product-addtocart-button, .product-card__button, .add-to-cart, #add-to-cart, .btn-buy, .action.tocart',
      );

      if (ctaButton) {
        const ctaText = ctaButton.innerText.toLowerCase();

        if (
          ctaButton.hasAttribute('disabled') ||
          ctaButton.classList.contains('disabled') ||
          ctaText.includes('out') ||
          ctaText.includes('sold out')
        ) {
          return 'out_of_stock';
        }

        if (ctaText.includes('pre-order') || ctaText.includes('preorder')) {
          return 'pre_order';
        }
      }

      // Пошук за текстовими маркерами та CSS-класами на сторінці
      const selectors = [
        '.stock.available',
        '.stock.unavailable',
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

          if (text.includes('in stock') || text.includes('available'))
            return 'in_stock';

          if (
            text.includes('out of stock') ||
            text.includes('out') ||
            text.includes('unavailable')
          )
            return 'out_of_stock';

          if (text.includes('pre-order') || text.includes('preorder'))
            return 'pre_order';
        }
      }

      // Контекстна підстановка: якщо кнопка купівлі активна і явних маркерів відсутності немає, вважається, що товар у наявності
      if (
        ctaButton &&
        !ctaButton.hasAttribute('disabled') &&
        !ctaButton.classList.contains('disabled')
      ) {
        return 'in_stock';
      }

      const allSpans = Array.from(
        document.querySelectorAll('#prices-new ~ span, .prices-new ~ span'),
      );

      for (const span of allSpans) {
        const text = span.innerText.toLowerCase();

        if (text.includes('in stock')) return 'in_stock';
        if (
          text.includes('out of stock') ||
          text.includes('out') ||
          text.includes('unavailable')
        )
          return 'out_of_stock';
        if (
          text.includes('pre-order') ||
          text.includes('preorder') ||
          text.includes('pre order')
        )
          return 'pre_order';
      }

      return null;
    });

    return status;
  } catch (e) {
    console.error(`[Error] getProductAvailability failed: ${e.message}`);
    return null;
  }
};

const getMainProductImage = async (page) => {
  try {
    // Отримує сире посилання на картинку з різних джерел в середині DOM
    const rawImageSrc = await page.evaluate(() => {
      const findImage = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        // За специфікацією Schema.org, поле може називатись image або primaryImageOfPage
        if (obj.image) {
          if (typeof obj.image === 'string') return obj.image;
          if (Array.isArray(obj.image) && obj.image[0]) return obj.image[0];
          if (typeof obj.image === 'object' && obj.image.url)
            return obj.image.url;
        }

        for (const key in obj) {
          const result = findImage(obj[key]);
          if (result) return result;
        }

        return null;
      };
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
        '#main-product-image',
        '#imagePopup',
        '.product-featured-image',
        '.product-single__photo img',
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
    console.error(`[Error] getMainProductImage failed: ${e.message}`);
    return null;
  }
};

const getAdditionalImages = async (page) => {
  try {
    const mainImageUrl = await getMainProductImage(page);
    // Збирає всі посилання на зображення галереї з DOM та JSON-LD
    const rawImages = await page.evaluate(() => {
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
    console.error(`[Error] getAdditionalImages failed: ${e.message}`);
    return null;
  }
};

const getTechnicalSpecifications = async (page) => {
  try {
    // Виконує код в середині контексту браузера для збору даних з DOM
    const specs = await page.evaluate(() => {
      // Очищує текст від сміттєвих символів
      const cleanStr = (str) => {
        if (!str) return '';
        return str
          .replace(/[\n\t\r]/g, ' ')
          .replace(/^[:\s\-•\.]+|[:\s\-•\.]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };

      const result = [];

      // Збір з класичних таблиць (<table>): шукає таблиці в середині табів, характеристик чи блоків з відповідними класами
      const selectors = [
        '#specs-table',
        '.product-specs',
        '.technical-specs',
        '.specification table',
        '.main table',
        '.table',
        'table',
      ];
      let tables = [];

      selectors.forEach((selector) => {
        const table = document.querySelectorAll(selector);

        if (table.length > 0) tables.push(...Array.from(table));
      });

      tables = [...new Set(tables)];

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
  } catch (e) {
    console.error(`[Error] getTechnicalSpecifications failed: ${e.message}`);
    return null;
  }
};

const getStarRating = async (page) => {
  try {
    // Отримує сирі дані рейтинга з DOM чи JSON-LD в середині браузера
    const rawRating = await page.evaluate(() => {
      const findRating = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        // Шукає стандартні поля Schema.org: AggregateRating -> ratingValue
        if (obj['@type'] === 'AggregateRating' && obj.ratingValue)
          return obj.ratingValue;
        if (obj.aggregateRating?.ratingValue)
          return obj.aggregateRating.ratingValue;

        for (const key in obj) {
          const result = findRating(obj[key]);

          if (result) return result;
        }

        return null;
      };
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
        '#average-rating #average-rating-info',
        '#average-rating',
        '#average-rating-link',
        '.product-card__rating-value',
        '.rating-number',
        '.average-rating',
        '.score',
        '[class*="rating"] .value',
        '.review-rating',
        '.rating',
      ];

      for (const selector of ratingSelectors) {
        const element = document.querySelector(selector);
        if (element?.innerText?.trim()) {
          const text = element.innerText.trim();
          // Страховка від текстів типу "Оцінка: 4.8" чи "4.8 з 5"
          if (
            /^[1-5]([.,]\d+)?$/.test(text) ||
            text.match(/([1-5](?:[.,]\d+)?)/)
          )
            return text;
        }
      }

      // Просунутий UX-фолбек (Парсинг процентів заповнення зврок зі стилів CSS)
      // Часто в темах зірковий рейтинг візуалізується через ширину блока: style="width: 90%"
      const fillStars = document.querySelector(
        '[class*="rating"] [style*="width"], .stars-fill, .rating-stars__active',
      );

      if (fillStars) {
        const widthStyle = fillStars.getAttribute('style');
        const match = widthStyle?.match(/width\s*:\s*(\d+(?:\.\d+)?)(?:px|%)/i);
        if (match) {
          const percentage = parseFloat(match[1]);
          if (widthStyle.includes('%') && percentage <= 100) {
            const calculated = String((percentage * 5) / 100);
            console.log('Рейтинг рассчитан из ширины %:', calculated);
            return calculated;
          }
        }
      }

      return null;
    });

    if (!rawRating) return null;

    // Обробка та нормалізація рядка в число на боці Node.js та заміна коми на крапку (на випадок формату "4,7")
    let cleaned = rawRating.replace(/,/g, '.').trim();
    // let cleaned = rawRating.replace(/,/g, '.');

    // Забирає тільки першу групу чисел з перемінною крапкою (наприклад: з строки "4.7 out of 5" забирає "4.7")
    const match = cleaned.match(/^([1-5](?:\.\d+)?)/);

    if (!match) {
      // Фолбек: если число не в начале, ищем просто первое совпадение
      const fallbackMatch = cleaned.match(/([1-5](?:\.\d+)?)/);
      if (!fallbackMatch) return null;
      cleaned = fallbackMatch[1];
    } else {
      cleaned = match[1];
    }

    const finalRating = parseFloat(match[1]);

    // Валідація: рейтинг в e-commerce не може бути більший за 5 чи менший за 0
    return !isNaN(finalRating) && finalRating >= 0 && finalRating <= 5
      ? finalRating
      : null;
  } catch (e) {
    console.error(`[Error] getStarRating failed: ${e.message}`);
    return null;
  }
};

const getReviewCount = async (page) => {
  try {
    // Забирає сирий текст чи число кількості відгуків з DOM / JSON-LD
    const rawCountText = await page.evaluate(() => {
      const findReviewCount = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        // Шукає стандартні поля Schema.org: AggregateRating -> reviewCount
        if (obj['@type'] === 'AggregateRating' && obj.reviewCount)
          return obj.reviewCount;
        if (obj.aggregateRating?.reviewCount)
          return obj.aggregateRating.reviewCount;

        for (const key in obj) {
          const result = findReviewCount(obj[key]);

          if (result) return result;
        }

        return null;
      };
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
        '#average-rating #average-rating-info',
        '#average-rating-link',
        '#average-rating',
        '#reviews-tab-trigger',
        '.product-card__review-count',
        '.review-count',
        '.reviews-total',
        '.rating-link',
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
    // Якщо в рядку є число в середині круглих дужок (наприклад: "4.7 (3)") - забирає тільки його
    const bracketsMatch = rawCountText.match(/\((\d+)\)/);
    if (bracketsMatch) {
      return parseInt(bracketsMatch[1], 10);
    }
    // Якщо рядок містить і оцінку, і кількість (наприклад: "4.7 з 5 на основі 3 відгуків") - забирає оцінку з крапкою\комою
    let targetText = rawCountText.replace(/[1-5][.,]\d/g, '');
    // Забирає перше число з рядка, що залишилось
    const generalMatch = targetText.match(/(\d+)/);
    if (generalMatch) {
      return parseInt(generalMatch[1], 10);
    }

    return null;
  } catch (e) {
    console.error(`[Error] getReviewCount failed: ${e.message}`);
    return null;
  }
};

const getGtin = async (page) => {
  try {
    const rawGtin = await page.evaluate(() => {
      // Рекурсивна функція для пошуку стандартних полівщтрих кодів в Schema.org
      const findGtinField = (obj) => {
        if (!obj || typeof obj !== 'object') return null;

        // Перевіряє всі стандартні специфікації штрихкодів
        if (obj.gtin) return obj.gtin;
        if (obj.gtin8) return obj.gtin8;
        if (obj.gtin12) return obj.gtin12;
        if (obj.gtin13) return obj.gtin13;
        if (obj.gtin14) return obj.gtin14;
        if (obj.upc) return obj.upc;
        if (obj.mpn) return obj.mpn;
        if (obj.isbn) return obj.isbn;

        for (const key in obj) {
          const result = findGtinField(obj[key]);

          if (result) return result;
        }

        return null;
      };
      // Шукає в глобальних об'єктах даних (Page Data / Window)
      // Сучасні CMS часто зберігають повні мета-дані в window.product, window.__NEXT_DATA__ і т.д.
      const idFromWindow =
        window?.productData?.gtin ||
        window?.productData?.upc ||
        window?.productData?.ean ||
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
        if (/\b(gtin|upc|ean|barcode|штрихкод)\b/i.test(text)) {
          return text;
        }
      }

      return null;
    });

    if (!rawGtin) return null;

    // Очищення рядка на боці Node.js: видаляє все за винятком чисел та букв (на випадок якщо код містить префікси)
    // Більшість кодів GTIN/UPC складаються суворо з 8, 12, 13 чи 14 чисел
    let cleaned = rawGtin.replace(/(gtin|upc|ean|barcode)/gi, '');

    // Якщо це був текстовий блок, витягає з нього тільки саму послідовність чисел (шукає блок чисел від 7 до 15 символів - стандарти штрахкодів + короткі MPN\серійники)
    const digitMatch = cleaned.match(/\b\d{7,15}\b/);
    if (digitMatch) {
      return digitMatch[0];
    }

    // Фолбек для буквено-числових кодів (наприклад:  MPN деталей: "A123-B") - видаляє спц символи та залишає букви і числа
    cleaned = cleaned.replace(/[^a-zA-Z0-9]/g, '').trim();

    // Якщо це довгий текст опису (більше 25 символів) - це сміття, повертає null
    if (cleaned.length > 25 || cleaned.length < 4) {
      return null;
    }

    return cleaned.trim().length > 0 ? cleaned.trim() : null;
  } catch (e) {
    console.error(`[Error] getGtin failed: ${e.message}`);
    return null;
  }
};

const getMpn = async (page) => {
  try {
    const rawMpn = await page.evaluate(() => {
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
      // Шукає в глобальних об'єктах даних (Page Data / Window) ===
      const idFromWindow =
        window?.productData?.mpn || window?.productData?.partNumber || null;

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
        '.sku-number',
        '.product-meta__sku',
      ];

      for (const selector of cssSelectors) {
        const element = document.querySelector(selector);

        if (element) {
          return element.getAttribute('data-mpn') || element.innerText;
        }
      }

      const rows = document.querySelectorAll('tr, li, p');

      // Словник синонімів MPN на різних мовах
      const mpnRegex = /(mpn|part number|partnumber|manufacturer number)/i;

      for (const row of rows) {
        const text = row.innerText || '';

        if (mpnRegex.test(text)) {
          // Якщо це рядок таблиці, забирає значення з правої комірки
          const cells = row.querySelectorAll('th, td');
          if (cells.length >= 2) {
            // Перевіряє що саме ліва комірка (назва) містить маркер MPN
            const keyText = (
              cells[0].innerText ||
              cells[0].textContent ||
              ''
            ).trim();
            if (mpnRegex.test(keyText)) {
              console.log(`MPN найден в таблице по ключу "${keyText.trim()}":`);
              return (cells[1].innerText || cells[1].textContent || '').trim();
            }
          }

          // Фолбек: якщо це звичайний рядок списку чи параграф (наприклад: "Модель: ABC-123")
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

    if (cleaned.length > 0 && cleaned.length < 60) {
      return cleaned;
    }

    return null;
  } catch (e) {
    console.error(`[Error] getMpn failed: ${e.message}`);
    return null;
  }
};

const getProductData = async (page, url) => {
  try {
    const productData = {
      url: page.url(),
      item_id: await getProductId(page, url),
      title: await getProductTitle(page, url),
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

    console.log(`Data successfully written to file: ${filename}`);
  } catch (error) {
    console.error(`Writing file error: ${error.message}`);
  }
};

const pageScraper = async (start, getProductData, writeProductData) => {
  try {
    const {page, browser} = await start(TARGET_URL);
    const productData = await getProductData(page, page.url());
    console.log('PgeScraper productData: ', productData);

    if (productData) writeProductData(productData);

    await browser.close();
  } catch (e) {
    throw new Error(e.message);
  }
};

pageScraper(start, getProductData, writeProductData);
