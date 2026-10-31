"use strict";

// KONGLOGAME - vanilla JavaScript wealth management game.
// Asset ownership is persisted by array index. Keep existing asset order when
// changing the catalog, or add a migration before reordering entries.

const SAVE_KEY = "investmentEmpireSave";
const SCHEMA_VERSION = 3;
const MAX_SAFE_MONEY = 1e15;
const MAX_QUANTITY = 1e9;

const ECONOMY_CONFIG = {
  currency: {
    usdToIdr: 16471,
  },
  startingMoney: 500,
  assetLevels: {
    maxLevel: 100,
  },
  mining: {
    levels: [
      { rate: 4, upgradeCost: 120 },
      { rate: 6, upgradeCost: 300 },
      { rate: 9, upgradeCost: 700 },
      { rate: 13, upgradeCost: 1500 },
      { rate: 18, upgradeCost: 3000 },
      { rate: 25, upgradeCost: 6000 },
      { rate: 34, upgradeCost: 12000 },
      { rate: 46, upgradeCost: 24000 },
      { rate: 62, upgradeCost: 48000 },
      { rate: 84, upgradeCost: 96000 },
      { rate: 113, upgradeCost: 192000 },
      { rate: 152, upgradeCost: 384000 },
      { rate: 205, upgradeCost: 768000 },
      { rate: 276, upgradeCost: 1536000 },
      { rate: 372, upgradeCost: null },
    ],
  },
  passiveCategories: {
    vehicles: { paybackStart: 900, paybackEnd: 2400 },
    motorcycle: { paybackStart: 720, paybackEnd: 1800 },
    realestate: { paybackStart: 1200, paybackEnd: 3000 },
    business: { paybackStart: 180, paybackEnd: 480 },
    industry: {
      paybackStart: 480,
      paybackEnd: 900,
      // Pin the pre-merge catalog range so cheaper additions cannot rebalance old incomes.
      minPrice: 2000000,
      maxPrice: 150000000,
    },
  },
  stocks: {
    updateIntervalMs: 15000,
    historyLength: 36,
    priceFloorMultiplier: 0.35,
    priceCeilingMultiplier: 3.5,
    meanReversion: 0.025,
    baselineDrift: 0.0002,
    dividendIntervalMs: 120000,
  },
  savings: {
    interestIntervalMs: 300000,
    interestRate: 0.0002,
    autoSaveIntervalMs: 120000,
    autoSavePortion: 0.25,
  },
  timers: {
    sweepIntervalMs: 30000,
    saveIntervalMs: 5000,
  },
  feedback: {
    toastDurationMs: 3600,
  },
};

const MAX_ASSET_LEVEL = ECONOMY_CONFIG.assetLevels.maxLevel;

const CATEGORY_META = {
  stocks: { label: "Stock Market", kind: "stock" },
  vehicles: { label: "Luxury Vehicles", kind: "physical" },
  motorcycle: { label: "Motorcycle Collection", kind: "physical" },
  realestate: { label: "Real Estate Portfolio", kind: "physical" },
  business: { label: "Small Business Ventures", kind: "business" },
  industry: { label: "Industrial Empire", kind: "business" },
};

const PASSIVE_CATEGORY_KEYS = Object.keys(CATEGORY_META).filter(
  (category) => category !== "stocks",
);

const assetData = {
  stocks: [
    { name: "Apple Inc.", ticker: "AAPL", price: 180, volatility: 0.011, dividendYield: 0.0012 },
    { name: "Microsoft Corp.", ticker: "MSFT", price: 340, volatility: 0.01, dividendYield: 0.001 },
    { name: "Google (Alphabet)", ticker: "GOOGL", price: 2800, volatility: 0.013, dividendYield: 0.0008 },
    { name: "Tesla Inc.", ticker: "TSLA", price: 250, volatility: 0.032, dividendYield: 0.0004 },
    { name: "Amazon.com", ticker: "AMZN", price: 3200, volatility: 0.015, dividendYield: 0.0007 },
    { name: "Meta Platforms", ticker: "META", price: 310, volatility: 0.02, dividendYield: 0.0009 },
    { name: "Netflix Inc.", ticker: "NFLX", price: 450, volatility: 0.022, dividendYield: 0.0008 },
    { name: "NVIDIA Corp.", ticker: "NVDA", price: 880, volatility: 0.028, dividendYield: 0.0005 },
    { name: "Bank Central Asia", ticker: "BBCA", price: 95, volatility: 0.012, dividendYield: 0.0018 },
    { name: "Telkom Indonesia", ticker: "TLKM", price: 45, volatility: 0.016, dividendYield: 0.002 },
    { name: "Garuda Indonesia", ticker: "GIAA", price: 120, volatility: 0.038, dividendYield: 0.0008 },
    { name: "Gudang Garam Tbk", ticker: "GGRM", price: 123, volatility: 0.018, dividendYield: 0.0015 },
    { name: "Johnson & Johnson", ticker: "JNJ", price: 145, volatility: 0.009, dividendYield: 0.0016 },
    { name: "JPMorgan Chase & CO", ticker: "JPM", price: 172, volatility: 0.013, dividendYield: 0.0013 },
    { name: "Visa Inc", ticker: "V", price: 245, volatility: 0.011, dividendYield: 0.001 },
    { name: "Master Card Inc", ticker: "MA", price: 312, volatility: 0.012, dividendYield: 0.001 },
    { name: "Procter & Gamble", ticker: "PG", price: 108, volatility: 0.009, dividendYield: 0.0016 },
    { name: "The CocaCola Company", ticker: "KO", price: 58, volatility: 0.008, dividendYield: 0.0018 },
    { name: "Pepsi CO", ticker: "PEP", price: 169, volatility: 0.01, dividendYield: 0.0014 },
    { name: "Walt Disney", ticker: "DIS", price: 94, volatility: 0.018, dividendYield: 0.0009 },
    { name: "McDonald's Corp", ticker: "MCD", price: 278, volatility: 0.01, dividendYield: 0.0012 },
    { name: "Intel Corp", ticker: "INTC", price: 42, volatility: 0.025, dividendYield: 0.0011 },
    { name: "Samsung Electronics", ticker: "005930", price: 61, volatility: 0.017, dividendYield: 0.0012 },
    { name: "Toyota Motors Corp", ticker: "TM", price: 139, volatility: 0.012, dividendYield: 0.0015 },
    { name: "Unilever PLC", ticker: "UL", price: 51, volatility: 0.011, dividendYield: 0.0017 },
    { name: "Exxonmobil Corp", ticker: "XOM", price: 119, volatility: 0.014, dividendYield: 0.0018 },
    { name: "Chevron Corp", ticker: "CVX", price: 165, volatility: 0.014, dividendYield: 0.0019 },
    { name: "Astra Internasional TBK", ticker: "ASII", price: 3.2, volatility: 0.018, dividendYield: 0.0015 },
    { name: "Bank Rakyat Indonesia TBK", ticker: "BBRI", price: 3.1, volatility: 0.018, dividendYield: 0.0017 },
  ],
  vehicles: [
    {
      name: "Lamborghini Aventador",
      price: 500000,
      image: "assets/images/vehicle/lamborghiniaventador.png",
    },
    {
      name: "Ferrari 488 GTB",
      price: 330000,
      image: "assets/images/vehicle/Ferrari488GTB.png",
    },
    {
      name: "McLaren 720S",
      price: 310000,
      image: "assets/images/vehicle/McLaren720S.png",
    },
    {
      name: "Bugatti Chiron",
      price: 3000000,
      image: "assets/images/vehicle/bugattichiron.png",
    },
    {
      name: "Rolls-Royce Phantom",
      price: 460000,
      image: "assets/images/vehicle/rollsroyce.png",
    },
    {
      name: "Toyota Fortuner",
      price: 12800,
      image: "assets/images/vehicle/fortuner.png",
    },
    {
      name: "Toyota Innova Reborn",
      price: 11500,
      image: "assets/images/vehicle/innova.png",
    },
    {
      name: "Mitsubishi Xforce",
      price: 9000,
      image: "assets/images/vehicle/xforce.png",
    },
    {
      name: "Mitsubishi Xpander",
      price: 8200,
      image: "assets/images/vehicle/expander.png",
    },
    {
      name: "Toyota Yaris",
      price: 12400,
      image: "assets/images/vehicle/yaris.png",
    },
    {
      name: "Mitsubishi L300",
      price: 9000,
      image: "assets/images/vehicle/l300.png",
    },
  ],
  motorcycle: [
    {
      name: "Kawasaki Ninja H2R",
      price: 46850,
      image: "assets/images/motorcycle/ninjah2r.png",
    },
    {
      name: "Kawasaki Ninja 400",
      price: 9000,
      image: "assets/images/motorcycle/ninja400.png",
    },
    {
      name: "Honda PCX 2025",
      price: 2410,
      image: "assets/images/motorcycle/pcx2025.png",
    },
    {
      name: "Yamaha NMAX Turbo",
      price: 2400,
      image: "assets/images/motorcycle/nmaxturbo.png",
    },
    {
      name: "Honda Vario 125 New",
      price: 1900,
      image: "assets/images/motorcycle/Proyek Baru 23 [5C6E267].png",
    },
    {
      name: "Honda Beat Street 2025",
      price: 1100,
      image: "assets/images/motorcycle/beatstreet.png",
    },
    {
      name: "Honda Beat Sporty",
      price: 1000,
      image: "assets/images/motorcycle/Beatsporty.png",
    },
    {
      name: "Yamaha Mio Sporty",
      price: 230,
      image: "assets/images/motorcycle/miosporty.png",
    },
    // Appended so existing save indices stay valid.
    {
      name: "Honda Vario 160 Modified",
      price: 2100,
      image: "assets/images/motorcycle/vario160.png",
    },
  ],
  realestate: [
    {
      name: "Luxury Penthouse NYC",
      price: 5000000,
      image: "assets/images/Real Estate/images (15).jpeg",
    },
    {
      name: "Beverly Hills Mansion",
      price: 8500000,
      image: "assets/images/Real Estate/images (16).jpeg",
    },
    {
      name: "Miami Beach Condo",
      price: 2200000,
      image: "assets/images/Real Estate/images (17).jpeg",
    },
    {
      name: "London Townhouse",
      price: 6700000,
      image: "assets/images/Real Estate/images (18).jpeg",
    },
    {
      name: "Tokyo Skyscraper Unit",
      price: 3800000,
      image: "assets/images/Real Estate/THE_TOKYO_TOWERS_JPN_0246.jpg",
    },
    {
      name: "Dubai Marina Apartment",
      price: 1900000,
      image: "assets/images/Real Estate/images (19).jpeg",
    },
    {
      name: "Singapore Sky Villa",
      price: 4500000,
      image: "assets/images/Real Estate/images (20).jpeg",
    },
    {
      name: "Paris Luxury Loft",
      price: 3200000,
      image: "assets/images/Real Estate/images (21).jpeg",
    },
    {
      name: "Swiss Alpine Chalet",
      price: 2800000,
      image: "assets/images/Real Estate/images (22).jpeg",
    },
    {
      name: "Bali Beachfront Villa",
      price: 1200000,
      image: "assets/images/Real Estate/images (23).jpeg",
    },
    {
      name: "Monaco Oceanview Suite",
      price: 7200000,
      image: "assets/images/Real Estate/images (24).jpeg",
    },
  ],
  industry: [
    {
      name: "Tech Software Company",
      price: 2000000,
      image: "assets/images/industry/TechSoftwareCompany.jpeg",
    },
    {
      name: "Pharmaceutical Lab",
      price: 5000000,
      image: "assets/images/industry/PharmaceuticalLab.jpeg",
    },
    {
      name: "Renewable Energy Plant",
      price: 8000000,
      image: "assets/images/industry/RenewableEnergyPlant.jpeg",
    },
    {
      name: "Automotive Factory",
      price: 12000000,
      image: "assets/images/industry/AutomotiveFactory.jpeg",
    },
    {
      name: "Mining Operation",
      price: 15000000,
      image: "assets/images/industry/MiningOperation.jpeg",
    },
    {
      name: "Oil Refinery",
      price: 25000000,
      image: "assets/images/industry/OilRefinery.jpeg",
    },
    {
      name: "Aerospace Manufacturing",
      price: 35000000,
      image: "assets/images/industry/AerospaceManufacturing.jpeg",
    },
    {
      name: "AI Research Facility",
      price: 50000000,
      image: "assets/images/industry/AIResearchFacility.jpeg",
    },
    {
      name: "Semiconductor Foundry",
      price: 75000000,
      image: "assets/images/industry/SemiconductorFoundry.jpeg",
    },
    {
      name: "Space Technology Corp",
      price: 100000000,
      image: "assets/images/industry/SpaceTechnologyCorp.jpeg",
    },
    {
      name: "Quantum Computing Lab",
      price: 150000000,
      image: "assets/images/industry/QuantumComputingLab.jpeg",
    },
    // Appended so existing save indices stay valid.
    {
      name: "Oil Palm Plantation",
      price: 1500000,
      image: "assets/images/industry/nyawit.png",
    },
  ],
  business: [
    {
      name: "Angkringan",
      price: 200,
      image: "assets/images/business/angkringan.jpeg",
    },
    {
      name: "Warung Madura",
      price: 256,
      image: "assets/images/business/warungmadura.jpeg",
    },
    {
      name: "Pecel Lele",
      price: 495,
      image: "assets/images/business/pecellele.jpeg",
    },
    {
      name: "Rental PS",
      price: 500,
      image: "assets/images/business/rentalps.jpeg",
    },
    {
      name: "Bengkel Motor",
      price: 540,
      image: "assets/images/business/bengkelmotor.jpeg",
    },
    {
      name: "Sedot WC",
      price: 560,
      image: "assets/images/business/sedotwc.jpeg",
    },
    {
      name: "Minimarket",
      price: 650,
      image: "assets/images/business/minimarket.jpeg",
    },
    {
      name: "Bubur Ayam",
      price: 600,
      image: "assets/images/business/buburayam.jpeg",
    },
    {
      name: "Warnet",
      price: 460,
      image: "assets/images/business/warnet.jpeg",
    },
    {
      name: "Warung Kopi",
      price: 750,
      image: "assets/images/business/warkop.jpeg",
    },
    {
      name: "Restoran Cepat Saji",
      price: 760,
      image: "assets/images/business/restorancepatsaji.jpeg",
    },
    {
      name: "Bakso Gerobak",
      price: 800,
      image: "assets/images/business/bakso.jpeg",
    },
    {
      name: "Sate Madura",
      price: 950,
      image: "assets/images/business/sate.jpeg",
    },
    {
      name: "Warteg",
      price: 900,
      image: "assets/images/business/warteg.jpeg",
    },
    {
      name: "Warung Nasi Padang",
      price: 1000,
      image: "assets/images/business/naspad.jpeg",
    },
    {
      name: "Es Teh Jumbo",
      price: 400,
      image: "assets/images/business/estehjumbo.jpeg",
    },
    {
      name: "Warung Madura 24 Jam",
      price: 1200,
      image: "assets/images/business/warungmadura24.jpeg",
    },
    {
      name: "Pecel Lele Lamongan",
      price: 1100,
      image: "assets/images/business/Lamongan.jpeg",
    },
    {
      name: "Gorengan Pinggir Jalan",
      price: 350,
      image: "assets/images/business/gorengan.jpeg",
    },
    {
      name: "Ayam Geprek",
      price: 1400,
      image: "assets/images/business/ayamgeprekawokawok.jpeg",
    },
    {
      name: "Martabak Manis & Telur",
      price: 1300,
      image: "assets/images/business/martabak.jpeg",
    },
    {
      name: "Toko Pulsa & Kuota",
      price: 1250,
      image: "assets/images/business/konterhp.jpeg",
    },
    {
      name: "Ojek Pangkalan",
      price: 1500,
      image: "assets/images/business/opang.jpeg",
    },
    {
      name: "Jasa Cuci Motor",
      price: 1600,
      image: "assets/images/business/jasacucimotor.jpeg",
    },
    {
      name: "Fotokopian",
      price: 1700,
      image: "assets/images/business/fotocopy.jpeg",
    },
    {
      name: "Rental PS & Warnet",
      price: 1800,
      image: "assets/images/business/warnet24ps.jpeg",
    },
    {
      name: "Percetakan Undangan",
      price: 2200,
      image: "assets/images/business/cetakundangan.jpeg",
    },
    {
      name: "Jasa Sedot WC",
      price: 2100,
      image: "assets/images/business/sedotwc25.jpeg",
    },
    {
      name: "Konter HP & Service",
      price: 2800,
      image: "assets/images/business/servicehp.jpeg",
    },
    {
      name: "Toko Kelontong",
      price: 2000,
      image: "assets/images/business/kelontong.jpeg",
    },
    {
      name: "Pasar Tradisional Kios",
      price: 5000,
      image: "assets/images/business/kioskois.jpeg",
    },
    {
      name: "Penyedia Lapak",
      price: 35000,
      image: "assets/images/business/penyedialapak.jpeg",
    },
    {
      name: "Rental Mobil",
      price: 24500,
      image: "assets/images/business/rentalmobil.jpeg",
    },
    {
      name: "Bengkel Mobil",
      price: 89000,
      image: "assets/images/business/bengkelmobil.jpeg",
    },
    {
      name: "Koprasi Simpan Pinjam",
      price: 100000,
      image: "assets/images/business/koprasi.jpeg",
    },
    {
      name: "Toko Emas",
      price: 150000,
      image: "assets/images/business/tokoemas.jpeg",
    },
  ],
};

prepareAssetEconomy();

function prepareAssetEconomy() {
  Object.entries(ECONOMY_CONFIG.passiveCategories).forEach(([category, config]) => {
    const items = assetData[category];
    const prices = items.map((item) => item.price);
    const minPrice = Number.isFinite(config.minPrice)
      ? config.minPrice
      : Math.min(...prices);
    const maxPrice = Number.isFinite(config.maxPrice)
      ? config.maxPrice
      : Math.max(...prices);
    const priceRange = maxPrice > minPrice ? Math.log(maxPrice / minPrice) : 1;

    items.forEach((asset) => {
      const position =
        maxPrice > minPrice
          ? Math.log(asset.price / minPrice) / priceRange
          : 0;
      const paybackSeconds =
        config.paybackStart +
        (config.paybackEnd - config.paybackStart) * clamp(position, 0, 1);

      asset.paybackSeconds = paybackSeconds;
      asset.incomePerSecond = asset.price / paybackSeconds;
    });
  });

  assetData.stocks.forEach((stock) => {
    stock.dividendPerShare = Math.max(
      0,
      Number((stock.price * stock.dividendYield).toFixed(4)),
    );
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function safeMoney(value) {
  return clamp(safeNumber(value, 0), 0, MAX_SAFE_MONEY);
}

function getRemainingCapacity(balance) {
  return Math.max(0, MAX_SAFE_MONEY - safeMoney(balance));
}

function safeQuantity(value) {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed <= 0 || parsed > MAX_QUANTITY) return null;
  return parsed;
}

function getAffordableQuantity(money, price, maxQuantity) {
  const available = safeMoney(money);
  const unitPrice = safeNumber(price, 0);
  const capacityCap = Math.min(
    MAX_QUANTITY,
    Math.max(0, Math.floor(safeNumber(maxQuantity, 0))),
  );
  if (!(unitPrice > 0) || capacityCap <= 0) return 0;

  let quantity = Math.min(capacityCap, Math.floor(available / unitPrice));
  while (quantity > 0 && unitPrice * quantity > available) {
    quantity -= 1;
  }
  return quantity;
}

function formatCompactNumber(value) {
  const number = safeNumber(value, 0);
  const absValue = Math.abs(number);
  const sign = number < 0 ? "-" : "";
  const suffixes = [
    "",
    "K",
    "M",
    "B",
    "T",
    "AA",
    "AB",
    "AC",
    "AD",
    "AE",
    "AF",
    "AG",
    "AH",
    "AI",
    "AJ",
    "AK",
    "AL",
    "AM",
    "AN",
    "AO",
    "AP",
    "AQ",
    "AR",
    "AS",
    "AT",
    "AU",
    "AV",
    "AW",
    "AX",
    "AY",
    "AZ",
    "BA",
    "BB",
    "BC",
    "BD",
    "BE",
    "BF",
    "BG",
    "BH",
    "BI",
    "BJ",
    "BK",
    "BL",
    "BM",
    "BN",
    "BO",
    "BP",
    "BQ",
    "BR",
    "BS",
    "BT",
    "BU",
    "BV",
    "BW",
    "BX",
    "BY",
    "BZ",
  ];

  let suffixIndex = 0;
  let dividedValue = absValue;

  while (dividedValue >= 1000 && suffixIndex < suffixes.length - 1) {
    dividedValue /= 1000;
    suffixIndex += 1;
  }

  if (suffixIndex === 0) {
    return sign + Math.floor(dividedValue).toLocaleString("en-US");
  }

  const digits = dividedValue >= 100 ? 1 : 2;
  return (
    sign +
    dividedValue.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) +
    suffixes[suffixIndex]
  );
}

function formatUsd(value, options = {}) {
  const number = safeNumber(value, 0);
  const absValue = Math.abs(number);
  const compact = Boolean(options.compact);
  const signed = Boolean(options.signed);

  if (compact && absValue >= 1000000) {
    const prefix = signed && number > 0 ? "+" : "";
    return prefix + "$" + formatCompactNumber(number);
  }

  const decimals =
    options.decimals === undefined ? (absValue < 1000 ? 2 : 0) : options.decimals;
  const prefix = signed && number > 0 ? "+" : number < 0 ? "-" : "";
  const formatted = Math.abs(number).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return prefix + "$" + formatted;
}

function formatIdr(value, options = {}) {
  const number = safeNumber(value, 0);
  const absValue = Math.abs(number);
  const compact = Boolean(options.compact);

  if (compact && absValue >= 1000000) {
    return "Rp " + formatCompactNumber(number);
  }

  const prefix = number < 0 ? "-" : "";
  return (
    prefix +
    "Rp " +
    Math.abs(number).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })
  );
}

function formatMoney(value, currency = "USD", options = {}) {
  return currency === "IDR"
    ? formatIdr(value, options)
    : formatUsd(value, options);
}

function formatUsdRate(value) {
  const number = safeNumber(value, 0);
  const absValue = Math.abs(number);
  if (absValue >= 1000000) return formatUsd(number, { compact: true }) + "/s";
  if (absValue >= 1000) return formatUsd(number, { decimals: 0 }) + "/s";
  if (absValue >= 10) return formatUsd(number, { decimals: 1 }) + "/s";
  return formatUsd(number, { decimals: 2 }) + "/s";
}

function formatStockPrice(value) {
  const number = safeNumber(value, 0);
  if (Math.abs(number) >= 10000000) {
    return formatUsd(number, { compact: true });
  }
  return formatUsd(number, { decimals: Math.abs(number) < 1000 ? 2 : 2 });
}

function formatPercent(value, signed = true) {
  const number = safeNumber(value, 0);
  const prefix = signed && number > 0 ? "+" : "";
  return prefix + number.toFixed(2) + "%";
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(safeNumber(seconds, 0)));
  if (total < 60) return total + "s";
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes < 60) {
    return remainder > 0 ? minutes + "m " + remainder + "s" : minutes + "m";
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0
    ? hours + "j " + minuteRemainder + "m"
    : hours + "j";
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(safeNumber(milliseconds, 0) / 1000));
  if (totalSeconds < 60) return totalSeconds + "s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? minutes + "m " + seconds + "s" : minutes + "m";
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0
    ? hours + "j " + minuteRemainder + "m"
    : hours + "j";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function nowMs() {
  return Date.now();
}

function createDefaultTimers(now = nowMs()) {
  return {
    stockUpdatedAt: now,
    dividendPaidAt: now,
    savingsInterestAt: now,
    sweepAt: now,
    autoSaveAt: now,
    savedAt: now,
  };
}

function createDefaultState(now = nowMs()) {
  const assets = {};
  Object.keys(CATEGORY_META).forEach((category) => {
    assets[category] = {};
  });

  return {
    version: SCHEMA_VERSION,
    money: ECONOMY_CONFIG.startingMoney,
    rupiahWallet: 0,
    savingsAccount: 0,
    stockDividends: 0,
    businessIncome: 0,
    level: 1,
    assets,
    stockMarket: {
      prices: assetData.stocks.map((stock) => stock.price),
      history: assetData.stocks.map((stock) => [stock.price]),
      lastUpdatedAt: now,
    },
    stockCostBasis: {},
    timers: createDefaultTimers(now),
    stats: {
      totalSavingsInterest: 0,
      totalStockIncome: 0,
      totalBusinessIncome: 0,
      totalCapitalGains: 0,
    },
  };
}

let gameState = createDefaultState();
let isResetting = false;

function getMiningLevelConfig() {
  const levels = ECONOMY_CONFIG.mining.levels;
  const level = clamp(
    Number.isInteger(gameState.level) ? gameState.level : 1,
    1,
    levels.length,
  );
  return levels[level - 1];
}

function getMiningRate() {
  return getMiningLevelConfig().rate;
}

function getAssetIncome(category, index) {
  const asset = assetData[category] ? assetData[category][index] : null;
  return asset && Number.isFinite(asset.incomePerSecond)
    ? asset.incomePerSecond
    : 0;
}

function getOwned(category, index) {
  const holdings = gameState.assets[category];
  if (!holdings) return 0;
  return safeQuantity(holdings[index]) || 0;
}

function isLevelAssetCategory(category) {
  return category === "business" || category === "industry";
}

function getLevelActionLabel(category, level) {
  if (level > 0) return "Ekspansi";
  return category === "industry" ? "Bangun Industri" : "Bangun Bisnis";
}

function getLevelIncome(asset, level) {
  return (asset && Number.isFinite(asset.incomePerSecond) ? asset.incomePerSecond : 0) *
    Math.max(0, safeNumber(level, 0));
}

// Expansion cost is the base price times the target level, so each level costs
// more than the last while income stays linear in level.
function getExpansionCost(asset, level, levels = 1) {
  if (!asset || !(asset.price > 0)) return null;
  let total = 0;
  for (let step = 1; step <= levels; step += 1) {
    const targetLevel = level + step;
    if (targetLevel > MAX_ASSET_LEVEL) return null;
    total += asset.price * targetLevel;
  }
  return Number.isFinite(total) && total <= MAX_SAFE_MONEY ? total : null;
}

function calculatePassiveIncome() {
  let physical = 0;
  let business = 0;

  PASSIVE_CATEGORY_KEYS.forEach((category) => {
    const holdings = gameState.assets[category] || {};
    Object.keys(holdings).forEach((key) => {
      const index = Number(key);
      const quantity = safeQuantity(holdings[key]) || 0;
      if (!Number.isInteger(index) || quantity <= 0) return;
      const asset = assetData[category][index];
      if (!asset) return;
      // Business/industry holdings store the level, so income scales with level.
      const income = (asset.incomePerSecond || 0) * quantity;
      if (category === "business" || category === "industry") {
        business += income;
      } else {
        physical += income;
      }
    });
  });

  return { physical, business };
}

function getCurrentIncome() {
  const { physical, business } = calculatePassiveIncome();
  return getMiningRate() + physical + business;
}

function getStockPrice(index) {
  const price = gameState.stockMarket.prices[index];
  const basePrice = assetData.stocks[index] ? assetData.stocks[index].price : 0;
  if (!Number.isFinite(price) || price <= 0) return basePrice;
  return price;
}

function getStockHistory(index) {
  const history = gameState.stockMarket.history[index];
  return Array.isArray(history) && history.length > 0
    ? history
    : [getStockPrice(index)];
}

function getStockDividendPerPeriod() {
  return assetData.stocks.reduce((total, stock, index) => {
    const shares = getOwned("stocks", index);
    return total + shares * (stock.dividendPerShare || 0);
  }, 0);
}

function getStockPortfolio() {
  let value = 0;
  let cost = 0;

  assetData.stocks.forEach((stock, index) => {
    const shares = getOwned("stocks", index);
    if (shares <= 0) return;
    value += shares * getStockPrice(index);
    cost += safeNumber(gameState.stockCostBasis[index], 0);
  });

  const pnl = value - cost;
  return {
    value,
    cost,
    pnl,
    pnlPercent: cost > 0 ? (pnl / cost) * 100 : 0,
  };
}

function addMoney(amount) {
  gameState.money = safeMoney(gameState.money + safeNumber(amount, 0));
}

function addWallet(currency, amount) {
  gameState[currency] = safeMoney(gameState[currency] + safeNumber(amount, 0));
}

function addStat(name, amount) {
  gameState.stats[name] = clamp(
    safeNumber(gameState.stats[name], 0) + safeNumber(amount, 0),
    -MAX_SAFE_MONEY,
    MAX_SAFE_MONEY,
  );
}

function getElement(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = getElement(id);
  if (element) element.textContent = text;
}

function setSignedClass(element, value) {
  if (!element) return;
  element.classList.remove("positive", "negative", "flat");
  if (value > 0) element.classList.add("positive");
  else if (value < 0) element.classList.add("negative");
  else element.classList.add("flat");
}

function trendIcon(direction) {
  const icon =
    direction === "up"
      ? "i-trend-up"
      : direction === "down"
        ? "i-trend-down"
        : "i-flat";
  return (
    '<svg class="icon" aria-hidden="true"><use href="#' + icon + '"></use></svg>'
  );
}

function showToast(message, type = "info") {
  const container = getElement("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const icon =
    type === "success" ? "i-check" : type === "error" ? "i-alert" : "i-info";
  toast.innerHTML =
    '<svg class="icon" aria-hidden="true"><use href="#' +
    icon +
    '"></use></svg><span></span>';
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);

  while (container.children.length > 4) {
    container.removeChild(container.firstElementChild);
  }

  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, ECONOMY_CONFIG.feedback.toastDurationMs);
}

function renderAssetCards(category) {
  const grid = getElement(category + "Grid");
  if (!grid) return;

  const items = assetData[category];
  const isLevel = isLevelAssetCategory(category);
  const incomeLabel = isLevel ? "Pendapatan" : "Pasif";

  grid.innerHTML = items
    .map((asset, index) => {
      const owned = getOwned(category, index);
      const level = isLevel ? owned : 0;
      const income = isLevel
        ? getLevelIncome(asset, level)
        : asset.incomePerSecond;
      const expansionCost = isLevel ? getExpansionCost(asset, level, 1) : null;
      const priceLabel = isLevel ? "Ekspansi" : "Harga";
      const priceText = isLevel
        ? expansionCost === null
          ? "MAX"
          : formatUsd(expansionCost, { decimals: 0 })
        : formatUsd(asset.price, { decimals: 0 });
      const ownedText = isLevel
        ? level > 0
          ? "Level " + level
          : "Belum dimiliki"
        : owned + " dimiliki";
      const metaText = isLevel
        ? "Level " +
          level +
          " / " +
          MAX_ASSET_LEVEL +
          " · Payback dasar " +
          formatDuration(asset.paybackSeconds) +
          "."
        : "Payback sekitar " +
          formatDuration(asset.paybackSeconds) +
          " per unit.";
      const image = asset.image
        ? '<img class="asset-image" src="' +
          escapeHtml(asset.image) +
          '" alt="' +
          escapeHtml(asset.name) +
          '" loading="lazy" />'
        : '<div class="asset-image asset-image-empty"></div>';
      const controls = isLevel
        ? '<div class="buy-row single">' +
          '<button class="btn btn-primary" id="expand-' +
          category +
          "-" +
          index +
          '" type="button" data-action="buy-asset" data-category="' +
          category +
          '" data-index="' +
          index +
          '" data-quantity="1">' +
          getLevelActionLabel(category, level) +
          "</button>" +
          "</div>"
        : '<div class="buy-row">' +
          '<input class="qty-input" id="qty-' +
          category +
          "-" +
          index +
          '" type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Jumlah ' +
          escapeHtml(asset.name) +
          '" />' +
          '<button class="btn btn-primary" type="button" data-action="buy-asset" data-category="' +
          category +
          '" data-index="' +
          index +
          '" data-use-input="true">Beli</button>' +
          "</div>" +
          '<div class="button-row compact-buttons">' +
          '<button class="btn btn-secondary" type="button" data-action="buy-asset" data-category="' +
          category +
          '" data-index="' +
          index +
          '" data-quantity="1">Beli 1</button>' +
          '<button class="btn btn-ghost" type="button" data-action="buy-asset-all" data-category="' +
          category +
          '" data-index="' +
          index +
          '">Semua</button>' +
          "</div>";

      return (
        '<article class="asset-card" id="asset-' +
        category +
        "-" +
        index +
        '">' +
        '<div class="asset-media">' +
        image +
        '<span class="owned-pill" id="owned-' +
        category +
        "-" +
        index +
        '">' +
        ownedText +
        "</span>" +
        "</div>" +
        '<div class="asset-body">' +
        '<div class="asset-title-row"><h3>' +
        escapeHtml(asset.name) +
        "</h3></div>" +
        '<div class="asset-metrics">' +
        '<div><span>' +
        priceLabel +
        '</span><strong id="price-' +
        category +
        "-" +
        index +
        '">' +
        priceText +
        "</strong></div>" +
        '<div><span>' +
        incomeLabel +
        '</span><strong class="positive" id="income-' +
        category +
        "-" +
        index +
        '">' +
        formatUsdRate(income) +
        "</strong></div>" +
        "</div>" +
        '<p class="asset-meta">' +
        metaText +
        "</p>" +
        controls +
        "</div>" +
        "</article>"
      );
    })
    .join("");
}

function renderStockCards() {
  const grid = getElement("stocksGrid");
  if (!grid) return;

  grid.innerHTML = assetData.stocks
    .map((stock, index) => {
      return (
        '<article class="stock-row" id="stock-' +
        index +
        '" data-trend="flat">' +
        '<div class="stock-identity">' +
        "<div><h3>" +
        escapeHtml(stock.name) +
        '</h3><span class="ticker">' +
        escapeHtml(stock.ticker) +
        "</span></div>" +
        '<svg class="sparkline" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><polyline id="spark-' +
        index +
        '" points=""></polyline></svg>' +
        "</div>" +
        '<div class="stock-quote">' +
        '<strong id="stock-price-' +
        index +
        '">' +
        formatStockPrice(stock.price) +
        "</strong>" +
        '<span class="stock-change flat" id="stock-change-' +
        index +
        '">' +
        trendIcon("flat") +
        "<span>0.00%</span></span>" +
        "</div>" +
        '<div class="stock-figure stock-dividend"><span>Dividen</span><strong id="stock-div-' +
        index +
        '">-</strong></div>' +
        '<div class="stock-figure stock-owned"><span>Dimiliki</span><strong id="stock-owned-' +
        index +
        '">0</strong></div>' +
        '<div class="stock-figure stock-value"><span>Nilai</span><strong id="stock-value-' +
        index +
        '">$0.00</strong></div>' +
        '<div class="stock-figure stock-pl"><span>P/L</span><strong id="stock-pl-' +
        index +
        '">$0.00</strong></div>' +
        '<div class="stock-actions">' +
        '<input class="qty-input" id="stock-qty-' +
        index +
        '" type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Jumlah saham ' +
        escapeHtml(stock.name) +
        '" />' +
        '<button class="btn btn-primary" type="button" data-action="buy-stock" data-index="' +
        index +
        '">Beli</button>' +
        '<button class="btn btn-secondary" type="button" data-action="sell-stock" data-index="' +
        index +
        '">Jual</button>' +
        '<button class="btn btn-ghost" id="stock-all-' +
        index +
        '" type="button" data-action="buy-asset-all" data-category="stocks" data-index="' +
        index +
        '" aria-label="Beli saham ' +
        escapeHtml(stock.name) +
        ' sebanyak mungkin">All In Beli</button>' +
        '<button class="btn btn-danger" id="stock-all-sell-' +
        index +
        '" type="button" data-action="sell-stock-all" data-index="' +
        index +
        '" aria-label="Jual semua saham ' +
        escapeHtml(stock.name) +
        '">All In Jual</button>' +
        "</div>" +
        "</article>"
      );
    })
    .join("");
}

function renderAllAssetCards() {
  PASSIVE_CATEGORY_KEYS.forEach(renderAssetCards);
  renderStockCards();
}

function updateSparkline(index) {
  const polyline = getElement("spark-" + index);
  if (!polyline) return;

  const values = getStockHistory(index).slice(-ECONOMY_CONFIG.stocks.historyLength);
  const series = values.length > 1 ? values : [values[0], values[0]];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const lastIndex = Math.max(1, series.length - 1);

  const points = series
    .map((value, pointIndex) => {
      const x = (pointIndex / lastIndex) * 120;
      const y = 31 - ((value - min) / range) * 27;
      return x.toFixed(2) + "," + y.toFixed(2);
    })
    .join(" ");

  polyline.setAttribute("points", points);
}

function updateStockUI() {
  assetData.stocks.forEach((stock, index) => {
    const price = getStockPrice(index);
    const history = getStockHistory(index);
    const previous =
      history.length > 1 ? history[history.length - 2] : stock.price;
    const change = previous > 0 ? ((price - previous) / previous) * 100 : 0;
    const shares = getOwned("stocks", index);
    const basis = safeNumber(gameState.stockCostBasis[index], 0);
    const value = shares * price;
    const pnl = value - basis;
    const direction = change > 0.0001 ? "up" : change < -0.0001 ? "down" : "flat";

    const row = getElement("stock-" + index);
    const priceEl = getElement("stock-price-" + index);
    const changeEl = getElement("stock-change-" + index);
    const divEl = getElement("stock-div-" + index);
    const ownedEl = getElement("stock-owned-" + index);
    const valueEl = getElement("stock-value-" + index);
    const plEl = getElement("stock-pl-" + index);
    const sellAllEl = getElement("stock-all-sell-" + index);

    if (row) row.dataset.trend = direction;
    if (priceEl) priceEl.textContent = formatStockPrice(price);
    if (changeEl) {
      changeEl.className = "stock-change " + direction;
      changeEl.innerHTML =
        trendIcon(direction) + "<span>" + formatPercent(change) + "</span>";
    }
    if (divEl) {
      divEl.textContent =
        formatUsd(stock.dividendPerShare, {
          decimals: stock.dividendPerShare < 1 ? 3 : 2,
        }) +
        " / " +
        formatDuration(ECONOMY_CONFIG.stocks.dividendIntervalMs / 1000);
    }
    if (ownedEl) ownedEl.textContent = shares.toLocaleString("en-US");
    if (valueEl) valueEl.textContent = formatUsd(value, { compact: true });
    if (plEl) {
      plEl.textContent = formatUsd(pnl, {
        signed: true,
        compact: Math.abs(pnl) >= 1000000,
      });
      setSignedClass(plEl, pnl);
    }
    if (sellAllEl) sellAllEl.disabled = shares <= 0;

    updateSparkline(index);
  });

  updatePortfolioSummary();
}

function updatePortfolioSummary() {
  const portfolio = getStockPortfolio();
  const dividend = getStockDividendPerPeriod();

  setText("portfolioValue", formatUsd(portfolio.value, { compact: true }));
  setText("portfolioCost", formatUsd(portfolio.cost, { compact: true }));
  setText(
    "portfolioPnl",
    formatUsd(portfolio.pnl, {
      signed: true,
      compact: Math.abs(portfolio.pnl) >= 1000000,
    }) +
      (portfolio.cost > 0 ? " (" + formatPercent(portfolio.pnlPercent) + ")" : ""),
  );
  setSignedClass(getElement("portfolioPnl"), portfolio.pnl);
  setText("portfolioDividend", formatUsd(dividend));
}

function updateAssetOwnership(category, index) {
  if (isLevelAssetCategory(category)) {
    updateLevelAssetUI(category, index);
  } else {
    const ownedEl = getElement("owned-" + category + "-" + index);
    if (ownedEl) {
      const owned = getOwned(category, index);
      ownedEl.textContent = owned + " dimiliki";
    }
  }
  updateCategoryCounts();
}

function updateLevelAssetUI(category, index) {
  if (!isLevelAssetCategory(category)) return;
  const asset = assetData[category] ? assetData[category][index] : null;
  if (!asset) return;

  const level = getOwned(category, index);
  const expansionCost = getExpansionCost(asset, level, 1);

  const ownedEl = getElement("owned-" + category + "-" + index);
  if (ownedEl) {
    ownedEl.textContent = level > 0 ? "Level " + level : "Belum dimiliki";
  }

  const priceEl = getElement("price-" + category + "-" + index);
  if (priceEl) {
    priceEl.textContent =
      expansionCost === null ? "MAX" : formatUsd(expansionCost, { decimals: 0 });
  }

  const incomeEl = getElement("income-" + category + "-" + index);
  if (incomeEl) {
    incomeEl.textContent = formatUsdRate(getLevelIncome(asset, level));
  }

  const button = getElement("expand-" + category + "-" + index);
  if (button) {
    const maxed = expansionCost === null;
    button.disabled = maxed || gameState.money < expansionCost;
    button.textContent = getLevelActionLabel(category, level);
  }
}

function updateLevelAssetCards() {
  ["business", "industry"].forEach((category) => {
    (assetData[category] || []).forEach((asset, index) =>
      updateLevelAssetUI(category, index),
    );
  });
}

function updateCategoryCounts() {
  PASSIVE_CATEGORY_KEYS.forEach((category) => {
    const total = Object.values(gameState.assets[category] || {}).reduce(
      (sum, quantity) => sum + (safeQuantity(quantity) || 0),
      0,
    );
    setText(category + "Count", total.toLocaleString("en-US"));
  });
}

function updateDashboardUI() {
  const currentIncome = getCurrentIncome();
  const miningRate = getMiningRate();
  const levels = ECONOMY_CONFIG.mining.levels;
  const level = clamp(gameState.level, 1, levels.length);
  const isMaxLevel = level >= levels.length;
  const nextLevelConfig = isMaxLevel ? null : levels[level];
  const upgradeCost = nextLevelConfig ? nextLevelConfig.upgradeCost : null;

  setText("mainWallet", formatUsd(gameState.money, { compact: true }));
  setText("topbarWallet", formatUsd(gameState.money, { compact: true }));
  setText(
    "floatingWalletValue",
    formatUsd(gameState.money, { compact: true }),
  );
  setText("incomeRate", formatUsdRate(currentIncome) + " / detik");
  setText("miningRate", formatUsdRate(miningRate));
  setText("currentLevel", String(level));
  setText("rupiahWallet", formatIdr(gameState.rupiahWallet, { compact: true }));
  setText("stockDividends", formatUsd(gameState.stockDividends));
  setText("businessIncome", formatUsd(gameState.businessIncome));
  setText("savingsAccount", formatIdr(gameState.savingsAccount, { compact: true }));

  const levelProgress = getElement("levelProgress");
  if (levelProgress) {
    levelProgress.style.width = ((level / levels.length) * 100).toFixed(1) + "%";
  }

  if (isMaxLevel) {
    setText("nextLevel", "MAX");
    setText("nextIncome", formatUsdRate(miningRate));
    setText("upgradeCost", "-");
  } else {
    setText("nextLevel", String(level + 1));
    setText("nextIncome", formatUsdRate(nextLevelConfig.rate));
    setText("upgradeCost", formatUsd(upgradeCost, { decimals: 0 }));
  }

  const upgradeBtn = getElement("upgradeBtn");
  if (upgradeBtn) {
    upgradeBtn.disabled = isMaxLevel || gameState.money < upgradeCost;
    upgradeBtn.textContent = isMaxLevel
      ? "Level maksimal"
      : "Upgrade level";
  }

  const savingsInfo = ECONOMY_CONFIG.savings;
  setText(
    "savingsInterestInfo",
    "Bunga " +
      (savingsInfo.interestRate * 100).toFixed(3) +
      "% setiap " +
      formatDuration(savingsInfo.interestIntervalMs / 1000) +
      ".",
  );
  setText("rateInfo", "1 USD = " + ECONOMY_CONFIG.currency.usdToIdr.toLocaleString("en-US") + " IDR");

  const now = nowMs();
  const sweepRemaining = Math.max(
    0,
    ECONOMY_CONFIG.timers.sweepIntervalMs - (now - gameState.timers.sweepAt),
  );
  setText(
    "sweepInfo",
    "Dompet pendapatan disapu otomatis ke saldo utama dalam " +
      formatCountdown(sweepRemaining) +
      ".",
  );

  updateLevelAssetCards();
  updateCountdowns(now);
  updateStatsDrawerUI();
  setSignedClass(getElement("portfolioPnl"), getStockPortfolio().pnl);
}

function updateCountdowns(now = nowMs()) {
  const stockRemaining = Math.max(
    0,
    ECONOMY_CONFIG.stocks.updateIntervalMs -
      (now - gameState.timers.stockUpdatedAt),
  );
  const dividendRemaining = Math.max(
    0,
    ECONOMY_CONFIG.stocks.dividendIntervalMs -
      (now - gameState.timers.dividendPaidAt),
  );

  setText("stockUpdateCountdown", formatCountdown(stockRemaining));
  setText("nextDividendCountdown", formatCountdown(dividendRemaining));
}

function updateStatsDrawerUI() {
  setText(
    "statsSavings",
    formatIdr(gameState.stats.totalSavingsInterest, { compact: true }),
  );
  setText("statsStock", formatUsd(gameState.stats.totalStockIncome));
  setText("statsBusiness", formatUsd(gameState.stats.totalBusinessIncome));
  setText(
    "statsCapitalGains",
    formatUsd(gameState.stats.totalCapitalGains, {
      signed: true,
      compact: Math.abs(gameState.stats.totalCapitalGains) >= 1000000,
    }),
  );
  setSignedClass(getElement("statsCapitalGains"), gameState.stats.totalCapitalGains);
  setText(
    "statsSavingsBalance",
    formatIdr(gameState.savingsAccount, { compact: true }),
  );
  setText("statsRupiah", formatIdr(gameState.rupiahWallet, { compact: true }));
  setText("statsStockWallet", formatUsd(gameState.stockDividends));
  setText("statsBusinessWallet", formatUsd(gameState.businessIncome));
  setText("statsMiningRate", formatUsdRate(getMiningRate()));
  setText("statsIncomeRate", formatUsdRate(getCurrentIncome()));
  setText(
    "statsPortfolioValue",
    formatUsd(getStockPortfolio().value, { compact: true }),
  );
}

function updateMarketCadenceText() {
  setText(
    "marketCadence",
    "Harga diperbarui setiap " +
      formatDuration(ECONOMY_CONFIG.stocks.updateIntervalMs / 1000) +
      " dengan volatilitas berbeda per saham.",
  );
}

function buyAsset(category, index, quantity) {
  if (category === "stocks") {
    return buyStock(index, quantity);
  }

  const asset = assetData[category] ? assetData[category][index] : null;
  if (!asset) {
    showToast("Aset tidak ditemukan.", "error");
    return false;
  }

  const parsedQuantity = safeQuantity(quantity);
  if (!parsedQuantity) {
    showToast("Jumlah harus bilangan bulat lebih dari 0.", "error");
    return false;
  }

  if (isLevelAssetCategory(category)) {
    const level = getOwned(category, index);
    if (level >= MAX_ASSET_LEVEL) {
      showToast("Level " + asset.name + " sudah maksimal.", "info");
      return false;
    }
    if (level + parsedQuantity > MAX_ASSET_LEVEL) {
      showToast(
        "Level maksimal " + MAX_ASSET_LEVEL + " untuk " + asset.name + ".",
        "error",
      );
      return false;
    }

    const expansionCost = getExpansionCost(asset, level, parsedQuantity);
    if (expansionCost === null) {
      showToast("Nilai ekspansi terlalu besar.", "error");
      return false;
    }

    if (!Number.isFinite(gameState.money) || gameState.money < expansionCost) {
      showToast(
        "Saldo tidak cukup. Butuh " + formatUsd(expansionCost) + ".",
        "error",
      );
      return false;
    }

    gameState.money = safeMoney(gameState.money - expansionCost);
    gameState.assets[category][index] = level + parsedQuantity;
    updateAssetOwnership(category, index);
    updateDashboardUI();
    saveGame();
    showToast(
      "Menaikkan " +
        asset.name +
        " ke Level " +
        (level + parsedQuantity) +
        " seharga " +
        formatUsd(expansionCost) +
        ".",
      "success",
    );
    return true;
  }

  const owned = getOwned(category, index);
  if (owned + parsedQuantity > MAX_QUANTITY) {
    showToast("Jumlah kepemilikan melewati batas aman.", "error");
    return false;
  }

  const total = asset.price * parsedQuantity;
  if (!Number.isFinite(total) || total > MAX_SAFE_MONEY) {
    showToast("Nilai transaksi terlalu besar.", "error");
    return false;
  }

  if (!Number.isFinite(gameState.money) || gameState.money < total) {
    showToast(
      "Saldo tidak cukup. Butuh " + formatUsd(total) + ".",
      "error",
    );
    return false;
  }

  gameState.money = safeMoney(gameState.money - total);
  gameState.assets[category][index] = owned + parsedQuantity;
  updateAssetOwnership(category, index);
  updateDashboardUI();
  saveGame();
  showToast(
    "Membeli " +
      parsedQuantity.toLocaleString("en-US") +
      " " +
      asset.name +
      " seharga " +
      formatUsd(total) +
      ".",
    "success",
  );
  return true;
}

function buyAssetAll(category, index) {
  if (category === "stocks") {
    const price = getStockPrice(index);
    const owned = getOwned("stocks", index);
    const remainingCapacity = MAX_QUANTITY - owned;
    if (remainingCapacity <= 0) {
      showToast("Kepemilikan saham sudah mencapai batas.", "info");
      return false;
    }
    const quantity = getAffordableQuantity(
      gameState.money,
      price,
      remainingCapacity,
    );
    if (quantity <= 0) {
      showToast("Saldo tidak cukup untuk membeli saham.", "error");
      return false;
    }
    return buyStock(index, quantity);
  }

  const asset = assetData[category] ? assetData[category][index] : null;
  if (!asset) {
    showToast("Aset tidak ditemukan.", "error");
    return false;
  }

  if (isLevelAssetCategory(category)) {
    const level = getOwned(category, index);
    let levels = 0;
    let total = 0;
    while (level + levels < MAX_ASSET_LEVEL) {
      const nextCost = asset.price * (level + levels + 1);
      if (total + nextCost > gameState.money) break;
      total += nextCost;
      levels += 1;
    }
    if (levels <= 0) {
      showToast("Saldo tidak cukup untuk ekspansi aset ini.", "error");
      return false;
    }
    return buyAsset(category, index, levels);
  }

  const owned = getOwned(category, index);
  const quantity = getAffordableQuantity(
    gameState.money,
    asset.price,
    MAX_QUANTITY - owned,
  );
  if (quantity <= 0) {
    showToast("Saldo tidak cukup untuk membeli aset ini.", "error");
    return false;
  }
  return buyAsset(category, index, quantity);
}

function buyStock(index, quantity) {
  const stock = assetData.stocks[index];
  if (!stock) {
    showToast("Saham tidak ditemukan.", "error");
    return false;
  }

  const parsedQuantity = safeQuantity(quantity);
  if (!parsedQuantity) {
    showToast("Jumlah saham harus bilangan bulat lebih dari 0.", "error");
    return false;
  }

  const owned = getOwned("stocks", index);
  if (owned + parsedQuantity > MAX_QUANTITY) {
    showToast("Jumlah saham melewati batas aman.", "error");
    return false;
  }

  const price = getStockPrice(index);
  const total = price * parsedQuantity;
  if (!Number.isFinite(total) || total > MAX_SAFE_MONEY) {
    showToast("Nilai transaksi terlalu besar.", "error");
    return false;
  }

  if (!Number.isFinite(gameState.money) || gameState.money < total) {
    showToast(
      "Saldo tidak cukup. Butuh " + formatUsd(total) + ".",
      "error",
    );
    return false;
  }

  gameState.money = safeMoney(gameState.money - total);
  gameState.assets.stocks[index] = owned + parsedQuantity;
  gameState.stockCostBasis[index] = Math.min(
    MAX_SAFE_MONEY,
    safeNumber(gameState.stockCostBasis[index], 0) + total,
  );

  updateStockUI();
  updateDashboardUI();
  saveGame();
  showToast(
    "Membeli " +
      parsedQuantity.toLocaleString("en-US") +
      " saham " +
      stock.ticker +
      " di " +
      formatStockPrice(price) +
      ".",
    "success",
  );
  return true;
}

function sellStock(index, quantity) {
  const stock = assetData.stocks[index];
  if (!stock) {
    showToast("Saham tidak ditemukan.", "error");
    return false;
  }

  const parsedQuantity = safeQuantity(quantity);
  if (!parsedQuantity) {
    showToast("Jumlah saham harus bilangan bulat lebih dari 0.", "error");
    return false;
  }

  const owned = getOwned("stocks", index);
  if (parsedQuantity > owned) {
    showToast("Jumlah jual melebihi kepemilikan saham.", "error");
    return false;
  }

  const price = getStockPrice(index);
  const proceeds = price * parsedQuantity;
  if (!Number.isFinite(proceeds) || proceeds > MAX_SAFE_MONEY) {
    showToast("Nilai penjualan terlalu besar.", "error");
    return false;
  }
  if (proceeds > getRemainingCapacity(gameState.money)) {
    showToast("Saldo utama penuh. Belanja dulu sebelum menjual saham.", "error");
    return false;
  }

  const basis = Math.max(0, safeNumber(gameState.stockCostBasis[index], 0));
  const averageBasis = owned > 0 ? basis / owned : 0;
  const removedBasis =
    parsedQuantity === owned ? basis : averageBasis * parsedQuantity;
  const realizedGain = proceeds - removedBasis;

  gameState.money = safeMoney(gameState.money + proceeds);
  gameState.assets.stocks[index] = owned - parsedQuantity;
  if (gameState.assets.stocks[index] <= 0) {
    delete gameState.assets.stocks[index];
    delete gameState.stockCostBasis[index];
  } else {
    gameState.stockCostBasis[index] = Math.max(0, basis - removedBasis);
  }
  addStat("totalCapitalGains", realizedGain);

  updateStockUI();
  updateDashboardUI();
  saveGame();
  showToast(
    "Menjual " +
      parsedQuantity.toLocaleString("en-US") +
      " saham " +
      stock.ticker +
      ". Hasil " +
      formatUsd(proceeds) +
      ", capital gain " +
      formatUsd(realizedGain, { signed: true }) +
      ".",
    realizedGain >= 0 ? "success" : "info",
  );
  return true;
}

function sellStockAll(index) {
  const stock = assetData.stocks[index];
  if (!stock) {
    showToast("Saham tidak ditemukan.", "error");
    return false;
  }

  const owned = getOwned("stocks", index);
  if (owned <= 0) {
    showToast(
      "Tidak ada saham " + stock.ticker + " yang bisa dijual.",
      "info",
    );
    return false;
  }

  return sellStock(index, owned);
}

function upgradeLevel() {
  const levels = ECONOMY_CONFIG.mining.levels;
  if (gameState.level >= levels.length) {
    showToast("Level mining sudah maksimal.", "info");
    return;
  }

  const currentConfig = levels[gameState.level - 1];
  const cost = currentConfig.upgradeCost;
  if (!Number.isFinite(cost) || gameState.money < cost) {
    showToast("Saldo tidak cukup untuk upgrade.", "error");
    return;
  }

  gameState.money = safeMoney(gameState.money - cost);
  gameState.level += 1;
  updateDashboardUI();
  saveGame();
  showToast(
    "Level mining naik ke " +
      gameState.level +
      ". Pendapatan sekarang " +
      formatUsdRate(getMiningRate()) +
      ".",
    "success",
  );
}

function convertToRupiah() {
  const input = getElement("usdAmount");
  const amount = parseFloat(input.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Masukkan jumlah USD yang valid.", "error");
    return;
  }
  if (amount > gameState.money) {
    showToast("Saldo USD tidak cukup.", "error");
    return;
  }

  const converted = amount * ECONOMY_CONFIG.currency.usdToIdr;
  if (converted > getRemainingCapacity(gameState.rupiahWallet)) {
    showToast("Jumlah konversi melebihi kapasitas dompet rupiah.", "error");
    return;
  }

  gameState.money = safeMoney(gameState.money - amount);
  addWallet("rupiahWallet", converted);
  input.value = "";
  updateDashboardUI();
  saveGame();
  showToast(
    "Menukar " +
      formatUsd(amount) +
      " menjadi " +
      formatIdr(amount * ECONOMY_CONFIG.currency.usdToIdr) +
      ".",
    "success",
  );
}

function convertToUsd() {
  const input = getElement("idrAmount");
  const amount = parseFloat(input.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Masukkan jumlah IDR yang valid.", "error");
    return;
  }
  if (amount > gameState.rupiahWallet) {
    showToast("Saldo rupiah tidak cukup.", "error");
    return;
  }

  const converted = amount / ECONOMY_CONFIG.currency.usdToIdr;
  if (converted > getRemainingCapacity(gameState.money)) {
    showToast("Jumlah konversi melebihi kapasitas saldo USD.", "error");
    return;
  }

  gameState.rupiahWallet = safeMoney(gameState.rupiahWallet - amount);
  addMoney(converted);
  input.value = "";
  updateDashboardUI();
  saveGame();
  showToast(
    "Menukar " + formatIdr(amount) + " menjadi " + formatUsd(amount / ECONOMY_CONFIG.currency.usdToIdr) + ".",
    "success",
  );
}

function convertAllUsdToRupiah() {
  if (gameState.money <= 0) {
    showToast("Saldo USD kosong.", "error");
    return;
  }

  const requested = gameState.money;
  const amount = Math.min(
    requested,
    getRemainingCapacity(gameState.rupiahWallet) /
      ECONOMY_CONFIG.currency.usdToIdr,
  );
  if (amount <= 0) {
    showToast("Dompet rupiah sudah mencapai kapasitas maksimum.", "error");
    return;
  }

  gameState.money = safeMoney(requested - amount);
  addWallet("rupiahWallet", amount * ECONOMY_CONFIG.currency.usdToIdr);
  const input = getElement("usdAmount");
  if (input) input.value = "";
  updateDashboardUI();
  saveGame();
  showToast(
    "Menukar " +
      formatUsd(amount) +
      " menjadi " +
      formatIdr(amount * ECONOMY_CONFIG.currency.usdToIdr) +
      "." +
      (amount < requested ? " Sebagian saldo tersisa karena kapasitas dompet." : ""),
    "success",
  );
}

function convertAllIdrToUsd() {
  if (gameState.rupiahWallet <= 0) {
    showToast("Saldo rupiah kosong.", "error");
    return;
  }

  const requested = gameState.rupiahWallet;
  const amount = Math.min(
    requested,
    getRemainingCapacity(gameState.money) *
      ECONOMY_CONFIG.currency.usdToIdr,
  );
  if (amount <= 0) {
    showToast("Saldo USD sudah mencapai kapasitas maksimum.", "error");
    return;
  }

  gameState.rupiahWallet = safeMoney(requested - amount);
  addMoney(amount / ECONOMY_CONFIG.currency.usdToIdr);
  const input = getElement("idrAmount");
  if (input) input.value = "";
  updateDashboardUI();
  saveGame();
  showToast(
    "Menukar " +
      formatIdr(amount) +
      " menjadi " +
      formatUsd(amount / ECONOMY_CONFIG.currency.usdToIdr) +
      "." +
      (amount < requested ? " Sebagian saldo tersisa karena kapasitas saldo USD." : ""),
    "success",
  );
}

function transferSavingsToRupiah() {
  const input = getElement("savingsTransferAmount");
  const amount = parseFloat(input.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Masukkan jumlah transfer yang valid.", "error");
    return;
  }
  if (amount > gameState.savingsAccount) {
    showToast("Saldo tabungan tidak cukup.", "error");
    return;
  }
  if (amount > getRemainingCapacity(gameState.rupiahWallet)) {
    showToast("Dompet rupiah sudah mencapai kapasitas maksimum.", "error");
    return;
  }

  gameState.savingsAccount = safeMoney(gameState.savingsAccount - amount);
  addWallet("rupiahWallet", amount);
  input.value = "";
  updateDashboardUI();
  saveGame();
  showToast(
    "Transfer " + formatIdr(amount) + " dari tabungan ke rupiah.",
    "success",
  );
}

function updateStockPrices(now = nowMs()) {
  const config = ECONOMY_CONFIG.stocks;

  assetData.stocks.forEach((stock, index) => {
    const current = getStockPrice(index);
    const u1 = Math.max(Number.EPSILON, Math.random());
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const meanReversion = -config.meanReversion * Math.log(current / stock.price);
    const volatility = clamp(stock.volatility, 0.001, 0.08);
    let next =
      current *
      Math.exp(config.baselineDrift + meanReversion + volatility * gaussian);

    if (!Number.isFinite(next) || next <= 0) next = stock.price;
    next = clamp(
      next,
      stock.price * config.priceFloorMultiplier,
      stock.price * config.priceCeilingMultiplier,
    );

    gameState.stockMarket.prices[index] = next;
    const history = getStockHistory(index).slice();
    history.push(next);
    gameState.stockMarket.history[index] = history.slice(
      -config.historyLength,
    );
  });

  gameState.stockMarket.lastUpdatedAt = now;
  updateStockUI();
}

function payStockDividends(now = nowMs()) {
  const dividend = getStockDividendPerPeriod();
  const credited = Math.min(
    dividend,
    getRemainingCapacity(gameState.stockDividends),
  );
  if (credited > 0) {
    addWallet("stockDividends", credited);
    addStat("totalStockIncome", credited);
  }
  gameState.timers.dividendPaidAt = now;
  return credited;
}

function creditSavingsInterest(now = nowMs()) {
  if (gameState.savingsAccount > 0) {
    const interest = Math.min(
      gameState.savingsAccount * ECONOMY_CONFIG.savings.interestRate,
      getRemainingCapacity(gameState.savingsAccount),
    );
    if (interest > 0) {
      gameState.savingsAccount = safeMoney(gameState.savingsAccount + interest);
      addStat("totalSavingsInterest", interest);
    }
  }
  gameState.timers.savingsInterestAt = now;
}

function sweepIncomeWallets(now = nowMs()) {
  const total = safeMoney(gameState.stockDividends + gameState.businessIncome);
  const moved = Math.min(total, getRemainingCapacity(gameState.money));
  if (moved > 0) {
    if (moved >= total) {
      gameState.stockDividends = 0;
      gameState.businessIncome = 0;
    } else {
      const remainingRatio = 1 - moved / total;
      gameState.stockDividends = safeMoney(
        gameState.stockDividends * remainingRatio,
      );
      gameState.businessIncome = safeMoney(
        gameState.businessIncome * remainingRatio,
      );
    }
    addMoney(moved);
  }
  gameState.timers.sweepAt = now;
}

function autoSaveToSavings(now = nowMs()) {
  if (gameState.rupiahWallet > 0) {
    const amount = Math.min(
      gameState.rupiahWallet * ECONOMY_CONFIG.savings.autoSavePortion,
      getRemainingCapacity(gameState.savingsAccount),
    );
    if (amount > 0) {
      gameState.rupiahWallet = safeMoney(gameState.rupiahWallet - amount);
      addWallet("savingsAccount", amount);
    }
  }
  gameState.timers.autoSaveAt = now;
}

function applyContinuousIncome() {
  const { physical, business } = calculatePassiveIncome();
  addMoney(getMiningRate() + physical);
  const creditedBusiness = Math.min(
    business,
    getRemainingCapacity(gameState.businessIncome),
  );
  if (creditedBusiness > 0) {
    addWallet("businessIncome", creditedBusiness);
    addStat("totalBusinessIncome", creditedBusiness);
  }
}

function timerIsDue(last, interval, now) {
  return (
    !Number.isFinite(last) ||
    last > now ||
    now - last >= interval
  );
}

function gameTick() {
  applyContinuousIncome();
  const now = nowMs();

  if (
    timerIsDue(
      gameState.timers.stockUpdatedAt,
      ECONOMY_CONFIG.stocks.updateIntervalMs,
      now,
    )
  ) {
    updateStockPrices(now);
    gameState.timers.stockUpdatedAt = now;
  }

  if (
    timerIsDue(
      gameState.timers.dividendPaidAt,
      ECONOMY_CONFIG.stocks.dividendIntervalMs,
      now,
    )
  ) {
    payStockDividends(now);
  }

  if (
    timerIsDue(
      gameState.timers.savingsInterestAt,
      ECONOMY_CONFIG.savings.interestIntervalMs,
      now,
    )
  ) {
    creditSavingsInterest(now);
  }

  if (
    timerIsDue(
      gameState.timers.sweepAt,
      ECONOMY_CONFIG.timers.sweepIntervalMs,
      now,
    )
  ) {
    sweepIncomeWallets(now);
  }

  if (
    timerIsDue(
      gameState.timers.autoSaveAt,
      ECONOMY_CONFIG.savings.autoSaveIntervalMs,
      now,
    )
  ) {
    autoSaveToSavings(now);
  }

  updateDashboardUI();

  if (
    timerIsDue(
      gameState.timers.savedAt,
      ECONOMY_CONFIG.timers.saveIntervalMs,
      now,
    )
  ) {
    saveGame();
    gameState.timers.savedAt = now;
  }
}

function normalizeNumber(value, fallback, min = 0, max = MAX_SAFE_MONEY) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function normalizeTimers(rawTimers, now) {
  const defaults = createDefaultTimers(now);
  if (!rawTimers || typeof rawTimers !== "object") return defaults;

  const intervals = {
    stockUpdatedAt: ECONOMY_CONFIG.stocks.updateIntervalMs,
    dividendPaidAt: ECONOMY_CONFIG.stocks.dividendIntervalMs,
    savingsInterestAt: ECONOMY_CONFIG.savings.interestIntervalMs,
    sweepAt: ECONOMY_CONFIG.timers.sweepIntervalMs,
    autoSaveAt: ECONOMY_CONFIG.savings.autoSaveIntervalMs,
    savedAt: ECONOMY_CONFIG.timers.saveIntervalMs,
  };

  Object.keys(defaults).forEach((key) => {
    const value = rawTimers[key];
    const interval = intervals[key];
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value > now ||
      now - value > interval * 2
    ) {
      defaults[key] = now;
    } else {
      defaults[key] = value;
    }
  });

  return defaults;
}

function normalizeStockMarket(rawMarket, now) {
  const prices = [];
  const history = [];
  const rawPrices = rawMarket && Array.isArray(rawMarket.prices) ? rawMarket.prices : [];
  const rawHistory =
    rawMarket && Array.isArray(rawMarket.history) ? rawMarket.history : [];

  assetData.stocks.forEach((stock, index) => {
    const floor = stock.price * ECONOMY_CONFIG.stocks.priceFloorMultiplier;
    const ceiling = stock.price * ECONOMY_CONFIG.stocks.priceCeilingMultiplier;
    const savedPrice = rawPrices[index];
    const price =
      Number.isFinite(savedPrice) && savedPrice > 0
        ? clamp(savedPrice, floor, ceiling)
        : stock.price;

    prices.push(price);

    const rawSeries = Array.isArray(rawHistory[index]) ? rawHistory[index] : [];
    const series = rawSeries
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => clamp(value, floor, ceiling))
      .slice(-ECONOMY_CONFIG.stocks.historyLength);

    if (series.length === 0) {
      series.push(price);
    } else if (series[series.length - 1] !== price) {
      series.push(price);
    }

    history.push(series.slice(-ECONOMY_CONFIG.stocks.historyLength));
  });

  return {
    prices,
    history,
    lastUpdatedAt: now,
  };
}

function normalizeAssets(rawAssets) {
  const assets = {};
  Object.keys(CATEGORY_META).forEach((category) => {
    assets[category] = {};
  });

  if (!rawAssets || typeof rawAssets !== "object") return assets;

  Object.keys(CATEGORY_META).forEach((category) => {
    const rawCategory = rawAssets[category];
    if (!rawCategory || typeof rawCategory !== "object") return;

    Object.keys(rawCategory).forEach((key) => {
      const index = Number(key);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= assetData[category].length
      ) {
        return;
      }
      const rawQuantity =
        typeof rawCategory[key] === "number"
          ? rawCategory[key]
          : Number(String(rawCategory[key]).trim());
      if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return;
      // Legacy business/industry quantities already map 1:1 to levels.
      const cap = isLevelAssetCategory(category)
        ? MAX_ASSET_LEVEL
        : MAX_QUANTITY;
      const quantity = Math.min(cap, Math.floor(rawQuantity));
      if (quantity > 0) assets[category][index] = quantity;
    });
  });

  return assets;
}

function migrateSave(rawSave) {
  const now = nowMs();
  const state = createDefaultState(now);

  if (!rawSave || typeof rawSave !== "object") return state;

  state.money = normalizeNumber(rawSave.money, state.money);
  state.rupiahWallet = normalizeNumber(rawSave.rupiahWallet, 0);
  state.savingsAccount = normalizeNumber(rawSave.savingsAccount, 0);
  state.stockDividends = normalizeNumber(rawSave.stockDividends, 0);
  state.businessIncome = normalizeNumber(rawSave.businessIncome, 0);
  state.level = Math.round(
    normalizeNumber(
      rawSave.level,
      1,
      1,
      ECONOMY_CONFIG.mining.levels.length,
    ),
  );
  state.assets = normalizeAssets(rawSave.assets);
  state.stockMarket = normalizeStockMarket(rawSave.stockMarket, now);
  state.timers = normalizeTimers(rawSave.timers, now);

  const rawStats = rawSave.stats && typeof rawSave.stats === "object" ? rawSave.stats : {};
  state.stats.totalSavingsInterest = normalizeNumber(rawStats.totalSavingsInterest, 0);
  state.stats.totalStockIncome = normalizeNumber(rawStats.totalStockIncome, 0);
  state.stats.totalBusinessIncome = normalizeNumber(rawStats.totalBusinessIncome, 0);
  state.stats.totalCapitalGains = normalizeNumber(
    rawStats.totalCapitalGains,
    0,
    -MAX_SAFE_MONEY,
    MAX_SAFE_MONEY,
  );

  const rawBasis =
    rawSave.stockCostBasis && typeof rawSave.stockCostBasis === "object"
      ? rawSave.stockCostBasis
      : {};

  assetData.stocks.forEach((stock, index) => {
    const shares = getOwnedFromAssets(state.assets, "stocks", index);
    if (shares <= 0) return;

    const savedBasis = rawBasis[index];
    if (Number.isFinite(savedBasis) && savedBasis >= 0) {
      state.stockCostBasis[index] = Math.min(savedBasis, MAX_SAFE_MONEY);
    } else {
      state.stockCostBasis[index] = Math.min(
        shares * stock.price,
        MAX_SAFE_MONEY,
      );
    }
  });

  state.version = SCHEMA_VERSION;
  return state;
}

function getOwnedFromAssets(assets, category, index) {
  const holdings = assets[category] || {};
  return safeQuantity(holdings[index]) || 0;
}

function loadGame() {
  if (typeof localStorage === "undefined") return;

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    gameState = migrateSave(parsed);
  } catch (error) {
    console.warn("KONGLOGAME: save tidak bisa dibaca.", error);
  }
}

function saveGame() {
  if (isResetting || typeof localStorage === "undefined") return;

  try {
    gameState.version = SCHEMA_VERSION;
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
  } catch (error) {
    console.warn("KONGLOGAME: save gagal.", error);
  }
}

function resetGame() {
  isResetting = true;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SAVE_KEY);
  }
  window.location.reload();
}

function switchPage(pageName) {
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === pageName;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    const active = panel.dataset.pagePanel === pageName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function switchTab(target, button) {
  const page = button.closest(".page");
  if (!page) return;

  page.querySelectorAll("[data-tab-target]").forEach((tabButton) => {
    const active = tabButton.dataset.tabTarget === target;
    tabButton.classList.toggle("active", active);
    tabButton.setAttribute("aria-selected", active ? "true" : "false");
  });

  page.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    const active = panel.dataset.tabPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

let statsPanelTrigger = null;
let resetModalTrigger = null;

function isFocusableElement(element) {
  return Boolean(
    element &&
      element.isConnected &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0,
  );
}

function restoreFocus(preferred, fallback) {
  const target = isFocusableElement(preferred) ? preferred : fallback;
  if (isFocusableElement(target)) target.focus();
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(isFocusableElement);
}

function trapFocus(event, container) {
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const outside = !container.contains(active);

  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

function openStatsPanel(trigger) {
  const panel = getElement("statsPanel");
  const backdrop = getElement("drawerBackdrop");
  const toggle = getElement("statsToggleBtn");
  if (!panel || !backdrop) return;

  if (panel.classList.contains("open")) {
    const closeButton = getElement("closeStatsBtn");
    if (closeButton) closeButton.focus();
    return;
  }

  statsPanelTrigger = trigger || document.activeElement;
  panel.removeAttribute("inert");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  updateStatsDrawerUI();

  const closeButton = getElement("closeStatsBtn");
  if (closeButton) closeButton.focus();
}

function closeStatsPanel() {
  const panel = getElement("statsPanel");
  const backdrop = getElement("drawerBackdrop");
  const toggle = getElement("statsToggleBtn");
  if (!panel || !backdrop) return;

  if (!panel.classList.contains("open")) {
    panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    return;
  }

  panel.classList.remove("open");
  panel.setAttribute("inert", "");
  panel.setAttribute("aria-hidden", "true");
  backdrop.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");

  const trigger = statsPanelTrigger;
  statsPanelTrigger = null;
  restoreFocus(trigger, toggle);
}

function openResetModal(trigger) {
  const modal = getElement("resetModal");
  if (!modal) return;

  const cancel = getElement("cancelResetBtn");
  if (!modal.hidden) {
    if (cancel) cancel.focus();
    return;
  }

  resetModalTrigger = trigger || document.activeElement;
  modal.hidden = false;
  modal.classList.add("show");

  const panel = getElement("statsPanel");
  if (panel && panel.classList.contains("open")) {
    panel.setAttribute("inert", "");
  }
  if (cancel) cancel.focus();
}

function closeResetModal() {
  const modal = getElement("resetModal");
  if (!modal || modal.hidden) return;

  modal.classList.remove("show");
  modal.hidden = true;

  const panel = getElement("statsPanel");
  if (panel && panel.classList.contains("open")) {
    panel.removeAttribute("inert");
  }

  const trigger = resetModalTrigger;
  resetModalTrigger = null;
  restoreFocus(trigger, getElement("resetModalBtn"));
}

function checkFloatingWalletVisibility() {
  const walletPanel = document.querySelector(".wallet-panel");
  const floating = getElement("floatingWallet");
  if (!walletPanel || !floating) return;

  const rect = walletPanel.getBoundingClientRect();
  const visible =
    rect.bottom > 0 && rect.top < window.innerHeight && rect.height > 0;
  floating.classList.toggle("show", !visible);
  floating.setAttribute("aria-hidden", visible ? "true" : "false");
}

function readInputQuantity(inputId) {
  const input = getElement(inputId);
  return input ? input.value : "";
}

function handleAction(action, button) {
  switch (action) {
    case "buy-asset": {
      const category = button.dataset.category;
      const index = Number(button.dataset.index);
      const quantity = button.dataset.useInput
        ? readInputQuantity("qty-" + category + "-" + index)
        : button.dataset.quantity;
      buyAsset(category, index, quantity);
      break;
    }
    case "buy-asset-all": {
      const category = button.dataset.category;
      const index = Number(button.dataset.index);
      buyAssetAll(category, index);
      break;
    }
    case "buy-stock": {
      const index = Number(button.dataset.index);
      buyStock(index, readInputQuantity("stock-qty-" + index));
      break;
    }
    case "sell-stock": {
      const index = Number(button.dataset.index);
      sellStock(index, readInputQuantity("stock-qty-" + index));
      break;
    }
    case "sell-stock-all": {
      const index = Number(button.dataset.index);
      sellStockAll(index);
      break;
    }
    case "convert-usd":
      convertToRupiah();
      break;
    case "convert-usd-all":
      convertAllUsdToRupiah();
      break;
    case "convert-idr":
      convertToUsd();
      break;
    case "convert-idr-all":
      convertAllIdrToUsd();
      break;
    case "transfer-savings":
      transferSavingsToRupiah();
      break;
    default:
      break;
  }
}

function setupEventListeners() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () =>
      switchTab(button.dataset.tabTarget, button),
    );
  });

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      handleAction(actionButton.dataset.action, actionButton);
    }
  });

  const upgradeBtn = getElement("upgradeBtn");
  if (upgradeBtn) upgradeBtn.addEventListener("click", upgradeLevel);

  const statsToggle = getElement("statsToggleBtn");
  if (statsToggle) {
    statsToggle.addEventListener("click", (event) =>
      openStatsPanel(event.currentTarget),
    );
  }

  const closeStats = getElement("closeStatsBtn");
  if (closeStats) closeStats.addEventListener("click", closeStatsPanel);

  const backdrop = getElement("drawerBackdrop");
  if (backdrop) backdrop.addEventListener("click", closeStatsPanel);

  const resetBtn = getElement("resetModalBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", (event) =>
      openResetModal(event.currentTarget),
    );
  }

  const cancelReset = getElement("cancelResetBtn");
  if (cancelReset) cancelReset.addEventListener("click", closeResetModal);

  const confirmReset = getElement("confirmResetBtn");
  if (confirmReset) confirmReset.addEventListener("click", resetGame);

  const resetModal = getElement("resetModal");
  if (resetModal) {
    resetModal.addEventListener("click", (event) => {
      if (event.target === resetModal) closeResetModal();
    });
  }

  document.addEventListener("keydown", (event) => {
    const modal = getElement("resetModal");
    if (event.key === "Escape") {
      if (modal && !modal.hidden) {
        closeResetModal();
        return;
      }

      const panel = getElement("statsPanel");
      if (panel && panel.classList.contains("open")) {
        closeStatsPanel();
      }
      return;
    }

    if (event.key !== "Tab") return;

    if (modal && !modal.hidden) {
      trapFocus(event, modal);
      return;
    }

    const panel = getElement("statsPanel");
    if (panel && panel.classList.contains("open")) {
      trapFocus(event, panel);
    }
  });

  window.addEventListener("scroll", checkFloatingWalletVisibility, {
    passive: true,
  });
  window.addEventListener("resize", checkFloatingWalletVisibility);
  window.addEventListener("pagehide", saveGame);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
  });
}

let loopTimer = null;

function startGameLoop() {
  if (loopTimer !== null) return;
  loopTimer = window.setInterval(gameTick, 1000);
}

function init() {
  loadGame();
  renderAllAssetCards();
  updateMarketCadenceText();
  updateStockUI();
  updateDashboardUI();
  updateCategoryCounts();
  setupEventListeners();
  checkFloatingWalletVisibility();
  startGameLoop();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function isTestModeEnabled() {
  return typeof window !== "undefined" && window.__KONGLOGAME_TEST__ === true;
}

function createTestApi() {
  return {
    resetState() {
      isResetting = true;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(SAVE_KEY);
        }
      } finally {
        isResetting = false;
      }
      gameState = createDefaultState();
      renderAllAssetCards();
      updateStockUI();
      updateDashboardUI();
      updateCategoryCounts();
      const toastContainer = getElement("toastContainer");
      if (toastContainer) toastContainer.innerHTML = "";
      saveGame();
    },
    setState(patch) {
      gameState = migrateSave({ ...gameState, ...patch });
      renderAllAssetCards();
      updateStockUI();
      updateDashboardUI();
      updateCategoryCounts();
    },
    setMoney(value) {
      gameState.money = safeMoney(value);
      updateDashboardUI();
    },
    setStockPrice(index, price) {
      if (!assetData.stocks[index]) return;
      const stock = assetData.stocks[index];
      const clamped = clamp(
        safeNumber(price, stock.price),
        stock.price * ECONOMY_CONFIG.stocks.priceFloorMultiplier,
        stock.price * ECONOMY_CONFIG.stocks.priceCeilingMultiplier,
      );
      gameState.stockMarket.prices[index] = clamped;
      const history = getStockHistory(index).slice();
      history.push(clamped);
      gameState.stockMarket.history[index] = history.slice(
        -ECONOMY_CONFIG.stocks.historyLength,
      );
      updateStockUI();
    },
    setTimer(key, value) {
      if (Object.prototype.hasOwnProperty.call(gameState.timers, key)) {
        gameState.timers[key] = value;
      }
    },
    updateStockPrices,
    gameTick,
    payDividends: payStockDividends,
    creditInterest: creditSavingsInterest,
    sweep: sweepIncomeWallets,
    migrateSave,
    stopLoop() {
      if (loopTimer !== null) {
        window.clearInterval(loopTimer);
        loopTimer = null;
      }
    },
    startLoop: startGameLoop,
  };
}

const publicApi = {
  getState: () => JSON.parse(JSON.stringify(gameState)),
  getConfig: () => JSON.parse(JSON.stringify(ECONOMY_CONFIG)),
  getAssetData: () => JSON.parse(JSON.stringify(assetData)),
  getCurrentIncome,
  getMiningRate,
  calculatePassiveIncome,
  getStockPortfolio,
  getStockDividendPerPeriod,
  getStockPrice,
  buyAsset,
  buyAssetAll,
  buyStock,
  sellStock,
  sellStockAll,
  upgradeLevel,
  saveGame,
  loadGame,
  formatUsd,
  formatIdr,
};

if (isTestModeEnabled()) {
  publicApi.__test = createTestApi();
}

window.KONGLOGAME = publicApi;
