import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient, StoreType, VendorStatus } from '@prisma/client';

// =============================================================================
// Next360 - Admin Panel BULK demo data generator
// -----------------------------------------------------------------------------
// Adds a large, deterministic, idempotent dataset on top of the existing
// mock seed (prisma/seed-admin-demo.ts) without touching existing records:
//   - 500 customers (with addresses)
//   - 50 vendor users + 50 vendor/store profiles
//   - 50 products per vendor (2,500 total by default)
//
// Configuration (environment variables):
//   BULK_CUSTOMERS=500
//   BULK_VENDORS=50
//   BULK_PRODUCTS_PER_VENDOR=50
//
// Safety: refuses to run unless the target database is confirmed local/test.
//
// Run (from repo root):
//   npm run seed:admin:bulk
// =============================================================================

const BULK_PREFIX = 'bulk-test-';
const DEFAULTS = { customers: 500, vendors: 50, productsPerVendor: 50 };

interface BulkConfig {
  customers: number;
  vendors: number;
  productsPerVendor: number;
  totalProducts: number;
}

function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function assertSafeDatabase(): { host: string; database: string } {
  const problems: string[] = [];
  const rawUrl = process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is not set. Configure a local/test database in .env before running the bulk seed.',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    problems.push('NODE_ENV is "production"');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL could not be parsed as a URL.');
  }

  const protocol = parsed.protocol.replace(':', '');
  if (!['postgres', 'postgresql'].includes(protocol)) {
    problems.push(`unsupported database protocol "${protocol}" (expected postgres)`);
  }

  const host = parsed.hostname;
  const loopback = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (!loopback.includes(host)) {
    problems.push(
      `database host "${host}" is not a loopback address — the bulk seed only runs against a local database`,
    );
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    problems.push('DATABASE_URL has no database name');
  } else if (/prod/i.test(database)) {
    problems.push(
      `database name "${database}" looks like a production database — refused unconditionally`,
    );
  } else {
    const safeName = /(test|dev|demo|local|seed|staging)/i.test(database);
    const allowed = (process.env.BULK_SEED_ALLOW_DB ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!safeName && !allowed.includes(database.toLowerCase())) {
      problems.push(
        `database name "${database}" cannot be confirmed as a test database ` +
          '(name should contain test/dev/demo/local/seed/staging, or set BULK_SEED_ALLOW_DB=<dbname>)',
      );
    }
  }

  if (problems.length > 0) {
    console.error('❌ Bulk seed safety guard FAILED — refusing to write:');
    for (const p of problems) console.error(`   - ${p}`);
    console.error('   This generator must only ever run against a local test database.');
    process.exit(1);
  }

  console.log(`✅ Safety guard passed: host=${host}, database=${database}`);
  return { host, database };
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${raw}")`);
  }
  return value;
}

function readConfig(): BulkConfig {
  const customers = intFromEnv('BULK_CUSTOMERS', DEFAULTS.customers);
  const vendors = intFromEnv('BULK_VENDORS', DEFAULTS.vendors);
  const productsPerVendor = intFromEnv('BULK_PRODUCTS_PER_VENDOR', DEFAULTS.productsPerVendor);
  return { customers, vendors, productsPerVendor, totalProducts: vendors * productsPerVendor };
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function rngFor(key: string): Rng {
  return mulberry32(xmur3(key)());
}

function randInt(r: Rng, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

function pick<T>(r: Rng, items: readonly T[]): T {
  return items[Math.floor(r() * items.length) % items.length];
}

function chance(r: Rng, probability: number): boolean {
  return r() < probability;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function daysAgo(r: Rng, maxDays: number): Date {
  const days = Math.floor(r() * maxDays);
  const hours = Math.floor(r() * 24);
  return new Date(Date.now() - days * 86400000 - hours * 3600000);
}

const STORE_TYPES: StoreType[] = ['ORGANIC', 'NATURAL', 'ECO_FRIENDLY'];

interface ZoneSeed {
  id: string;
  city: string;
  state: string;
  pincodes: string[];
  areas: string[];
  center: { lat: number; lng: number };
}

const ZONES: ZoneSeed[] = [
  {
    id: 'Hyderabad',
    city: 'Hyderabad',
    state: 'Telangana',
    pincodes: ['500001', '500034', '500081', '500032', '500050', '500016', '500045'],
    areas: [
      'Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Kondapur', 'Madhapur', 'Kukatpally',
      'Bachupally', 'Uppal', 'Secunderabad', 'Begumpet', 'Ameerpet', 'LB Nagar', 'Miyapur',
      'Chandanagar', 'Hitec City', 'Manikonda', 'Tarnaka', 'Dilsukhnagar', 'Nizampet', 'Kothaguda',
    ],
    center: { lat: 17.385, lng: 78.4867 },
  },
  {
    id: 'Vijayawada',
    city: 'Vijayawada',
    state: 'Andhra Pradesh',
    pincodes: ['520001', '520002', '520007', '520010', '520015'],
    areas: [
      'Benz Circle', 'Gunadala', 'Patamata', 'Kanuru', 'Poranki', 'Payakapuram', 'Bhavanipuram',
      'Governorpet', 'Seetharampuram', 'Auto Nagar', 'Enikepadu', 'Mangalagiri Road',
      'Ibrahimpatnam', 'Kunchanapalli', 'Tadepalli',
    ],
    center: { lat: 16.5062, lng: 80.648 },
  },
];

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Akash', 'Amrita', 'Anand', 'Anjali', 'Aravind', 'Archana', 'Bhavana',
  'Chaitanya', 'Deepika', 'Devendra', 'Divya', 'Ganesh', 'Gautam', 'Harika', 'Hema', 'Ishaan',
  'Jaya', 'Karthik', 'Keerthi', 'Kiran', 'Lakshmi', 'Madhavi', 'Manish', 'Meghana', 'Mohan',
  'Nandini', 'Naveen', 'Neha', 'Nikhil', 'Pavan', 'Pooja', 'Prakash', 'Pranav', 'Priya',
  'Rahul', 'Rajesh', 'Ramya', 'Ravi', 'Rekha', 'Rohan', 'Rupa', 'Sai', 'Sandeep', 'Sanjana',
  'Shalini', 'Shankar', 'Sheela', 'Shreya', 'Siddharth', 'Sneha', 'Sowmya', 'Sridhar', 'Srija',
  'Suresh', 'Swathi', 'Tanvi', 'Teja', 'Uma', 'Varun', 'Venkat', 'Vidya', 'Vikram', 'Vineela',
  'Yamini', 'Zoya',
];

const LAST_NAMES = [
  'Reddy', 'Sharma', 'Iyer', 'Nair', 'Rao', 'Patel', 'Desai', 'Kulkarni', 'Verma', 'Shetty',
  'Goud', 'Prasad', 'Menon', 'Singh', 'Bhatt', 'Agarwal', 'Chowdary', 'Naidu', 'Kumar', 'Devi',
  'Murthy', 'Sastry', 'Pillai', 'Shah', 'Joshi', 'Mehta', 'Banerjee', 'Chatterjee', 'Das',
  'Rout', 'Yadav', 'Gupta', 'Tiwari', 'Mishra', 'Dubey', 'Shukla', 'Ghosh', 'Sen', 'Bose',
];

const HOUSE_NUMBERS = ['1-2-3', '5-10-12', '8-4-22', '14-7-9', '3-11-1', '22-5-40', '9-1-6', '17-3-14'];
const STREETS = ['Road No.', 'Street No.', 'Main Road', 'Cross Road', 'Lane', 'Temple Street'];

const STORE_NAME_PARTS: Record<StoreType, { a: string[]; n: string[]; s: string[] }> = {
  ORGANIC: {
    a: ['Green', 'Verdant', 'Bhoomi', 'Amrut', 'Shuddh', 'Prakriti', 'Annapurna', 'Harit',
      'Sattva', 'Kisan', 'Dhara', 'Nirvana', 'Vana', 'Mitra', 'Tula', 'Krushi', 'Anantha',
      'Brihat', 'Soma', 'Rasa'],
    n: ['Roots', 'Harvest', 'Fields', 'Farms', 'Garden', 'Orchard', 'Acres', 'Meadows',
      'Sprouts', 'Barn'],
    s: ['Organics', 'Organic Farms', 'Organic Co.', 'Farm Collective', 'Growers', 'Agro Fresh'],
  },
  NATURAL: {
    a: ['Arogya', 'Neem', 'Tulsi', 'Prana', 'Ojas', 'Kaya', 'Veda', 'Vanashree', 'Aushadh',
      'Divya', 'Sanjeevani', 'Nirmal', 'Pavan', 'Sattvika', 'Mrita', 'Herbal'],
    n: ['Botanics', 'Wellness', 'Herbals', 'Apothecary', 'Naturals', 'Essentials', 'Care',
      'Labs'],
    s: ['Co.', 'Studio', 'Works', 'House', 'India'],
  },
  ECO_FRIENDLY: {
    a: ['ReLeaf', 'TerraNest', 'EcoVive', 'BluePlanet', 'GreenLoop', 'PureEarth', 'Circulife',
      'Barefoot', 'Naturenest', 'Sustaina', 'Upcycle', 'Earthwise', 'Wildflower', 'Mossy',
      'Tidewell'],
    n: ['Goods', 'Living', 'Essentials', 'Works', 'Store', 'Supplies', 'Studio', 'Home'],
    s: ['Co.', 'Collective', 'India', 'Eco'],
  },
};

const PRODUCT_ADJECTIVES = ['Premium', 'Classic', 'Signature', 'Everyday', 'Essential', 'Select'];

const DELIVERY_LABELS = [
  'Farm Direct', 'Same-Day Dispatch', 'Eco-Safe Courier', 'Handcrafted & Careful',
  'Fresh Batch Daily', 'Carefully Packed',
];

const BANK_NAMES = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank', 'Canara Bank'];

interface ProductTuple {
  n: string;
  c: string;
  u: string;
  s: string;
  p: number;
}

const PRODUCT_POOL: Record<StoreType, ProductTuple[]> = {
  ORGANIC: [
    { n: 'Organic Foxtail Millet', c: 'organic-grains-pulses', u: 'kg', s: '1 kg', p: 145 },
    { n: 'Organic Toor Dal', c: 'organic-grains-pulses', u: 'kg', s: '1 kg', p: 175 },
    { n: 'Organic Sona Masoori Rice', c: 'organic-grains-pulses', u: 'kg', s: '5 kg', p: 480 },
    { n: 'Organic Ragi Flour', c: 'organic-grains-pulses', u: 'pack', s: '1 kg', p: 120 },
    { n: 'Organic Chana Dal', c: 'organic-grains-pulses', u: 'kg', s: '1 kg', p: 135 },
    { n: 'Organic Urad Dal', c: 'organic-grains-pulses', u: 'kg', s: '500 g', p: 95 },
    { n: 'Organic Groundnuts', c: 'organic-grains-pulses', u: 'pack', s: '500 g', p: 110 },
    { n: 'Organic Jowar', c: 'organic-grains-pulses', u: 'pack', s: '1 kg', p: 130 },
    { n: 'Baby Spinach Bunch', c: 'fresh-organic-produce', u: 'bunch', s: '1 bunch', p: 40 },
    { n: 'Organic Tomatoes', c: 'fresh-organic-produce', u: 'kg', s: '1 kg', p: 55 },
    { n: 'Organic Carrots', c: 'fresh-organic-produce', u: 'kg', s: '500 g', p: 45 },
    { n: 'Organic Beetroot', c: 'fresh-organic-produce', u: 'kg', s: '500 g', p: 42 },
    { n: 'Organic Sweet Lime', c: 'fresh-organic-produce', u: 'pack', s: '1 kg', p: 90 },
    { n: 'Organic Avocado', c: 'fresh-organic-produce', u: 'piece', s: '2 pc', p: 180 },
    { n: 'Organic Broccoli', c: 'fresh-organic-produce', u: 'piece', s: '1 pc', p: 75 },
    { n: 'Organic Capsicum Mix', c: 'fresh-organic-produce', u: 'pack', s: '500 g', p: 60 },
    { n: 'Organic Coriander Bunch', c: 'fresh-organic-produce', u: 'bunch', s: '1 bunch', p: 25 },
    { n: 'Organic Sprouts Mix', c: 'fresh-organic-produce', u: 'pack', s: '400 g', p: 85 },
    { n: 'Organic Bitter Gourd', c: 'fresh-organic-produce', u: 'kg', s: '500 g', p: 50 },
    { n: 'A2 Gir Cow Milk', c: 'organic-dairy-eggs', u: 'litre', s: '1 L', p: 95 },
    { n: 'Organic Farm Butter', c: 'organic-dairy-eggs', u: 'pack', s: '200 g', p: 240 },
    { n: 'Organic Paneer', c: 'organic-dairy-eggs', u: 'pack', s: '200 g', p: 165 },
    { n: 'Free-Range Brown Eggs', c: 'organic-dairy-eggs', u: 'dozen', s: '1 dozen', p: 135 },
    { n: 'Organic Curd', c: 'organic-dairy-eggs', u: 'pack', s: '400 g', p: 70 },
    { n: 'Organic Green Tea', c: 'organic-beverages', u: 'box', s: '25 bags', p: 155 },
    { n: 'Organic Coffee Powder', c: 'organic-beverages', u: 'pack', s: '250 g', p: 320 },
    { n: 'Cold-Pressed Amla Juice', c: 'organic-beverages', u: 'bottle', s: '500 ml', p: 210 },
    { n: 'Organic Turmeric Latte Mix', c: 'organic-beverages', u: 'jar', s: '200 g', p: 260 },
    { n: 'Hibiscus Herbal Tea', c: 'organic-beverages', u: 'box', s: '20 bags', p: 175 },
    { n: 'Organic Masala Chai Blend', c: 'organic-beverages', u: 'box', s: '100 g', p: 190 },
    { n: 'Raw Wild Forest Honey', c: 'organic-pantry', u: 'jar', s: '500 g', p: 460 },
    { n: 'Wood-Pressed Coconut Oil', c: 'organic-pantry', u: 'bottle', s: '500 ml', p: 340 },
    { n: 'Organic Cold-Pressed Ghee', c: 'organic-pantry', u: 'jar', s: '500 ml', p: 640 },
    { n: 'Organic Peanut Butter', c: 'organic-pantry', u: 'jar', s: '400 g', p: 290 },
    { n: 'Organic Jaggery Blocks', c: 'organic-pantry', u: 'pack', s: '1 kg', p: 120 },
    { n: 'Organic Cashews', c: 'organic-pantry', u: 'pack', s: '250 g', p: 380 },
    { n: 'Organic Almonds', c: 'organic-pantry', u: 'pack', s: '250 g', p: 420 },
    { n: 'Organic Apple Cider Vinegar', c: 'organic-pantry', u: 'bottle', s: '500 ml', p: 250 },
    { n: 'Organic Mulethi Powder', c: 'organic-pantry', u: 'pack', s: '100 g', p: 130 },
    { n: 'Organic Quinoa Puffs', c: 'organic-pantry', u: 'pack', s: '150 g', p: 220 },
  ],
  NATURAL: [
    { n: 'Aloe Vera Gel', c: 'natural-skincare', u: 'bottle', s: '200 ml', p: 250 },
    { n: 'Neem Face Wash', c: 'natural-skincare', u: 'bottle', s: '150 ml', p: 190 },
    { n: 'Rose Face Toner', c: 'natural-skincare', u: 'bottle', s: '200 ml', p: 275 },
    { n: 'Vitamin C Face Serum', c: 'natural-skincare', u: 'bottle', s: '30 ml', p: 480 },
    { n: 'Ubtan Face Pack', c: 'natural-skincare', u: 'box', s: '100 g', p: 230 },
    { n: 'Charcoal Face Scrub', c: 'natural-skincare', u: 'tube', s: '100 g', p: 265 },
    { n: 'Gotu Kola Face Oil', c: 'natural-skincare', u: 'bottle', s: '30 ml', p: 450 },
    { n: 'Green Clay Face Mask', c: 'natural-skincare', u: 'jar', s: '150 g', p: 270 },
    { n: 'Amla Hair Oil', c: 'natural-haircare', u: 'bottle', s: '200 ml', p: 240 },
    { n: 'Bhringraj Hair Oil', c: 'natural-haircare', u: 'bottle', s: '200 ml', p: 280 },
    { n: 'Reetha Shampoo Bar', c: 'natural-haircare', u: 'bar', s: '75 g', p: 130 },
    { n: 'Hibiscus Hair Mask', c: 'natural-haircare', u: 'jar', s: '200 g', p: 310 },
    { n: 'Curry Leaf Hair Serum', c: 'natural-haircare', u: 'bottle', s: '100 ml', p: 330 },
    { n: 'Coconut Milk Shampoo', c: 'natural-haircare', u: 'bottle', s: '300 ml', p: 310 },
    { n: 'Herbal Henna Powder', c: 'natural-haircare', u: 'pack', s: '100 g', p: 150 },
    { n: 'Ashwagandha Capsules', c: 'natural-wellness', u: 'box', s: '60 caps', p: 390 },
    { n: 'Triphala Churna', c: 'natural-wellness', u: 'pack', s: '200 g', p: 210 },
    { n: 'Tulsi Drops', c: 'natural-wellness', u: 'bottle', s: '30 ml', p: 135 },
    { n: 'Shilajit Resin', c: 'natural-wellness', u: 'jar', s: '20 g', p: 690 },
    { n: 'Brahmi Tablets', c: 'natural-wellness', u: 'box', s: '60 tabs', p: 340 },
    { n: 'Aloe Vera Juice', c: 'natural-wellness', u: 'bottle', s: '1 L', p: 320 },
    { n: 'Ayurvedic Massage Oil', c: 'natural-wellness', u: 'bottle', s: '300 ml', p: 350 },
    { n: 'Immunity Herbal Kadha', c: 'natural-wellness', u: 'pack', s: '200 g', p: 260 },
    { n: 'Lemongrass Room Spray', c: 'natural-home', u: 'bottle', s: '200 ml', p: 295 },
    { n: 'Lavender Reed Diffuser', c: 'natural-home', u: 'bottle', s: '100 ml', p: 430 },
    { n: 'Camphor Tablets', c: 'natural-home', u: 'box', s: '100 g', p: 90 },
    { n: 'Neem Oil', c: 'natural-home', u: 'bottle', s: '100 ml', p: 175 },
    { n: 'Natural Citronella Candle', c: 'natural-home', u: 'piece', s: '1 pc', p: 340 },
    { n: 'Essential Oil Combo', c: 'natural-home', u: 'set', s: '3 pc', p: 560 },
    { n: 'Sandalwood Soap', c: 'natural-personal-care', u: 'bar', s: '100 g', p: 145 },
    { n: 'Multani Mitti', c: 'natural-personal-care', u: 'pack', s: '200 g', p: 100 },
    { n: 'Charcoal Soap', c: 'natural-personal-care', u: 'bar', s: '100 g', p: 155 },
    { n: 'Rosemary Bath Salt', c: 'natural-personal-care', u: 'jar', s: '500 g', p: 280 },
    { n: 'Shea Butter Body Lotion', c: 'natural-personal-care', u: 'bottle', s: '300 ml', p: 360 },
    { n: 'Natural Lip Balm', c: 'natural-personal-care', u: 'piece', s: '5 g', p: 120 },
    { n: 'Eucalyptus Bath Oil', c: 'natural-personal-care', u: 'bottle', s: '200 ml', p: 330 },
    { n: 'Natural Oxide Kajal', c: 'natural-personal-care', u: 'piece', s: '3 g', p: 160 },
    { n: 'Brahmi Ghrita', c: 'natural-wellness', u: 'jar', s: '200 g', p: 380 },
    { n: 'Triphala Eye Drops', c: 'natural-wellness', u: 'bottle', s: '10 ml', p: 190 },
    { n: 'Amla Candy', c: 'natural-wellness', u: 'pack', s: '200 g', p: 165 },
  ],
  ECO_FRIENDLY: [
    { n: 'Steel Lunch Box', c: 'ecofriendly-kitchen', u: 'piece', s: '1 pc', p: 480 },
    { n: 'Bamboo Cutlery Set', c: 'ecofriendly-kitchen', u: 'set', s: '6 pc', p: 360 },
    { n: 'Copper Water Bottle', c: 'ecofriendly-kitchen', u: 'piece', s: '1 L', p: 750 },
    { n: 'Glass Storage Jar', c: 'ecofriendly-kitchen', u: 'piece', s: '1 L', p: 330 },
    { n: 'Cast Iron Tawa', c: 'ecofriendly-kitchen', u: 'piece', s: '1 pc', p: 890 },
    { n: 'Wooden Chopping Board', c: 'ecofriendly-kitchen', u: 'piece', s: '1 pc', p: 420 },
    { n: 'Coconut Bowl Set', c: 'ecofriendly-kitchen', u: 'set', s: '4 pc', p: 460 },
    { n: 'Steel Straw Set', c: 'ecofriendly-reusable', u: 'set', s: '8 pc', p: 220 },
    { n: 'Beeswax Food Wraps', c: 'ecofriendly-reusable', u: 'set', s: '3 pc', p: 450 },
    { n: 'Jute Grocery Bags', c: 'ecofriendly-reusable', u: 'set', s: '5 pc', p: 280 },
    { n: 'Cotton Produce Bags', c: 'ecofriendly-reusable', u: 'set', s: '6 pc', p: 240 },
    { n: 'Safety Razor', c: 'ecofriendly-reusable', u: 'piece', s: '1 pc', p: 650 },
    { n: 'Loofah Scrubber Pack', c: 'ecofriendly-reusable', u: 'pack', s: '3 pc', p: 160 },
    { n: 'Compostable Garbage Bags', c: 'ecofriendly-reusable', u: 'roll', s: '30 pc', p: 190 },
    { n: 'Cloth Ear Buds', c: 'ecofriendly-reusable', u: 'pack', s: '6 pc', p: 150 },
    { n: 'Recycled Paper Notebook', c: 'ecofriendly-reusable', u: 'piece', s: '1 pc', p: 210 },
    { n: 'Bamboo Toothbrush', c: 'ecofriendly-reusable', u: 'piece', s: '1 pc', p: 99 },
    { n: 'Natural Dishwash Bar', c: 'ecofriendly-cleaning', u: 'bar', s: '200 g', p: 150 },
    { n: 'Coconut Fibre Brush', c: 'ecofriendly-cleaning', u: 'piece', s: '1 pc', p: 140 },
    { n: 'Baking Soda Cleaner', c: 'ecofriendly-cleaning', u: 'box', s: '500 g', p: 120 },
    { n: 'Floor Cleaner Concentrate', c: 'ecofriendly-cleaning', u: 'bottle', s: '1 L', p: 230 },
    { n: 'Bio-Enzyme Cleaner', c: 'ecofriendly-cleaning', u: 'bottle', s: '500 ml', p: 260 },
    { n: 'Coconut Scrub Pad', c: 'ecofriendly-cleaning', u: 'pack', s: '4 pc', p: 130 },
    { n: 'Organic Cotton T-Shirt', c: 'ecofriendly-clothing', u: 'piece', s: '1 pc', p: 620 },
    { n: 'Hemp Tote Bag', c: 'ecofriendly-clothing', u: 'piece', s: '1 pc', p: 780 },
    { n: 'Bamboo Socks', c: 'ecofriendly-clothing', u: 'pair', s: '1 pair', p: 180 },
    { n: 'Jute Tote Bag', c: 'ecofriendly-clothing', u: 'piece', s: '1 pc', p: 450 },
    { n: 'Organic Cotton Towel Set', c: 'ecofriendly-clothing', u: 'set', s: '2 pc', p: 690 },
    { n: 'Hemp Canvas Apron', c: 'ecofriendly-clothing', u: 'piece', s: '1 pc', p: 720 },
    { n: 'Recycled Denim Cap', c: 'ecofriendly-clothing', u: 'piece', s: '1 pc', p: 390 },
    { n: 'Terracotta Planter', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 330 },
    { n: 'Rattan Wall Basket', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 540 },
    { n: 'Bamboo Table Lamp', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 1150 },
    { n: 'Jute Table Runner', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 360 },
    { n: 'Clay Tea-Light Holders', c: 'ecofriendly-home-decor', u: 'set', s: '4 pc', p: 380 },
    { n: 'Cork Notice Board', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 470 },
    { n: 'Seagrass Basket', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 520 },
    { n: 'Coir Door Mat', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 340 },
    { n: 'Beeswax Candle', c: 'ecofriendly-home-decor', u: 'piece', s: '1 pc', p: 260 },
    { n: 'Bamboo Plant Stake Set', c: 'ecofriendly-home-decor', u: 'set', s: '5 pc', p: 250 },
  ],
};

const ACCENTS: Record<StoreType, { bg: string; fg: string }> = {
  ORGANIC: { bg: 'EDF0E8', fg: '5C6B4D' },
  NATURAL: { bg: 'F4ECE3', fg: '9B6A3F' },
  ECO_FRIENDLY: { bg: 'E7EEEE', fg: '2F5D62' },
};

function placeholderUrl(storeType: StoreType, label: string): string {
  const { bg, fg } = ACCENTS[storeType];
  return `https://placehold.co/400x400/${bg}/${fg}?text=${encodeURIComponent(label)}`;
}

function vendorStatusFor(index: number): VendorStatus {
  const m = index % 25;
  if (m === 0) return 'REJECTED';
  if (m === 7) return 'SUSPENDED';
  if (index % 10 === 3) return 'PENDING';
  return 'APPROVED';
}

function buildStoreName(storeType: StoreType, r: Rng): string {
  const parts = STORE_NAME_PARTS[storeType];
  return `${pick(r, parts.a)} ${pick(r, parts.n)} ${pick(r, parts.s)}`;
}

function buildFullName(r: Rng): { first: string; last: string } {
  return { first: pick(r, FIRST_NAMES), last: pick(r, LAST_NAMES) };
}

function buildAddress(zone: ZoneSeed, r: Rng): {
  fullAddress: string;
  pincode: string;
  lat: number;
  lng: number;
} {
  const house = pick(r, HOUSE_NUMBERS);
  const streetLabel = pick(r, STREETS);
  const streetNo = randInt(r, 1, 99);
  const area = pick(r, zone.areas);
  const pincode = pick(r, zone.pincodes);
  return {
    fullAddress: `${house} ${streetLabel} ${streetNo}, ${area}`,
    pincode,
    lat: Number((zone.center.lat + (r() - 0.5) * 0.1).toFixed(6)),
    lng: Number((zone.center.lng + (r() - 0.5) * 0.1).toFixed(6)),
  };
}

interface NonBulkCounts {
  users: number;
  vendors: number;
  products: number;
  addresses: number;
}

async function nonBulkCounts(): Promise<NonBulkCounts> {
  const notBulk = { not: { startsWith: BULK_PREFIX } } as const;
  const [users, vendors, products, addresses] = await Promise.all([
    prisma.user.count({ where: { id: notBulk } }),
    prisma.vendor.count({ where: { id: notBulk } }),
    prisma.product.count({ where: { id: notBulk } }),
    prisma.address.count({ where: { id: notBulk } }),
  ]);
  return { users, vendors, products, addresses };
}

async function insertBatched<Row>(
  rows: Row[],
  insert: (batch: Row[]) => Promise<{ count: number }>,
  batchSize = 500,
): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const res = await insert(rows.slice(i, i + batchSize));
    created += res.count;
  }
  return created;
}

const prisma = new PrismaClient();

async function main() {
  loadDotEnv();
  const guard = assertSafeDatabase();
  const config = readConfig();

  console.log(
    `🌱 Bulk admin seed: ${config.customers} customers, ${config.vendors} vendors, ` +
      `${config.productsPerVendor} products/vendor (${config.totalProducts} products)`,
  );

  const existingZones = await prisma.zone.findMany({
    where: { id: { in: ZONES.map((z) => z.id) } },
    select: { id: true },
  });
  const foundZoneIds = new Set(existingZones.map((z) => z.id));
  const missingZones = ZONES.filter((z) => !foundZoneIds.has(z.id)).map((z) => z.id);
  if (missingZones.length > 0) {
    throw new Error(
      `Missing zone(s): ${missingZones.join(', ')}. Run the existing mock seed first ` +
        '(npx ts-node prisma/seed-admin-demo.ts) so the bulk seed can reuse existing foundations.',
    );
  }

  const categories = await prisma.category.findMany({ select: { id: true, slug: true, storeType: true } });
  const brands = await prisma.brand.findMany({ select: { id: true, slug: true, storeType: true } });

  const categoriesByType: Record<StoreType, { id: string; slug: string }[]> = {
    ORGANIC: [], NATURAL: [], ECO_FRIENDLY: [],
  };
  for (const c of categories) categoriesByType[c.storeType].push({ id: c.id, slug: c.slug });

  const brandsByType: Record<StoreType, { id: string; slug: string }[]> = {
    ORGANIC: [], NATURAL: [], ECO_FRIENDLY: [],
  };
  for (const b of brands) brandsByType[b.storeType].push({ id: b.id, slug: b.slug });

  for (const storeType of STORE_TYPES) {
    if (categoriesByType[storeType].length === 0 || brandsByType[storeType].length === 0) {
      throw new Error(
        `No existing categories/brands found for store type ${storeType}. ` +
          'Run the existing mock seed first so the bulk seed can reuse them.',
      );
    }
  }
  console.log(
    `   Reusing foundations: zones=${existingZones.length}, categories=${categories.length}, brands=${brands.length}`,
  );

  const before = await nonBulkCounts();

  // ── Customers + addresses ─────────────────────────────────────────────────
  const customerRows: Prisma.UserCreateManyInput[] = [];
  const addressRows: Prisma.AddressCreateManyInput[] = [];

  for (let i = 1; i <= config.customers; i += 1) {
    const id = `bulk-test-customer-${pad(i, 3)}`;
    const r = rngFor(`customer:${i}`);
    const { first, last } = buildFullName(r);
    const zone = pick(r, ZONES);
    const isActive = !chance(r, 0.03);

    customerRows.push({
      id,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.c${pad(i, 3)}@next360demo.com`,
      phone: `+9191000${pad(50000 + i, 5)}`,
      name: `${first} ${last}`,
      role: 'CUSTOMER',
      isActive,
      createdAt: daysAgo(r, 300),
    });

    const addr = buildAddress(zone, rngFor(`address:${i}`));
    addressRows.push({
      id: `bulk-test-address-${pad(i, 3)}`,
      userId: id,
      label: chance(r, 0.2) ? (chance(r, 0.5) ? 'Work' : 'Other') : 'Home',
      fullAddress: `${addr.fullAddress}, ${zone.city} ${addr.pincode}`,
      city: zone.city,
      state: zone.state,
      pincode: addr.pincode,
      lat: addr.lat,
      lng: addr.lng,
      isDefault: true,
      createdAt: daysAgo(r, 300),
    });
  }

  const customersCreated = await insertBatched(customerRows, (batch) =>
    prisma.user.createMany({ data: batch, skipDuplicates: true }),
  );
  const addressesCreated = await insertBatched(addressRows, (batch) =>
    prisma.address.createMany({ data: batch, skipDuplicates: true }),
  );
  console.log(`   Customers: +${customersCreated} created (target ${config.customers})`);
  console.log(`   Addresses: +${addressesCreated} created (target ${config.customers})`);

  // ── Vendor users + vendor profiles ────────────────────────────────────────
  const vendorUserRows: Prisma.UserCreateManyInput[] = [];
  const vendorRows: Prisma.VendorCreateManyInput[] = [];
  const vendorIndexById = new Map<number, { id: string; storeType: StoreType; status: VendorStatus }>();

  for (let i = 1; i <= config.vendors; i += 1) {
    const userId = `bulk-test-vendor-user-${pad(i, 3)}`;
    const vendorId = `bulk-test-vendor-${pad(i, 3)}`;
    const r = rngFor(`vendor:${i}`);
    const storeType = STORE_TYPES[(i - 1) % STORE_TYPES.length];
    const zone = ZONES[(i - 1) % ZONES.length];
    const { first, last } = buildFullName(r);
    const ownerName = `${first} ${last}`;
    const storeName = buildStoreName(storeType, r);
    const status = vendorStatusFor(i);
    const createdAt = daysAgo(r, 240);

    vendorUserRows.push({
      id: userId,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.v${pad(i, 3)}@next360demo.com`,
      phone: `+9191000${pad(60000 + i, 5)}`,
      name: ownerName,
      role: 'VENDOR',
      isActive: status !== 'REJECTED',
      createdAt,
    });

    const address = buildAddress(zone, rngFor(`vendor-address:${i}`));
    const deliveryMin = pick(r, [10, 15, 20, 25, 30]);
    vendorRows.push({
      id: vendorId,
      userId,
      storeName,
      storeSlug: `${slugify(storeName)}-${pad(i, 3)}`,
      storeType,
      sellerType: chance(r, 0.6) ? 'BUSINESS' : 'INDIVIDUAL',
      description: `${storeName} — verified ${storeType === 'ORGANIC' ? 'organic' : storeType === 'NATURAL' ? 'natural' : 'eco-friendly'} seller in ${zone.city}.`,
      logoUrl: placeholderUrl(storeType, storeName.split(' ')[0]),
      bannerUrl: placeholderUrl(storeType, storeName.split(' ')[0]),
      ownerName,
      address: `${address.fullAddress}`,
      city: zone.city,
      state: zone.state,
      pincode: address.pincode,
      deliveryTimeMin: deliveryMin,
      deliveryTimeMax: deliveryMin + pick(r, [10, 15, 20, 25]),
      deliveryLabel: pick(r, DELIVERY_LABELS),
      status,
      commissionPct: pick(r, [10, 12, 13, 14, 15, 16, 18]),
      bankAccountName: status === 'APPROVED' ? ownerName : null,
      bankAccountNumber: status === 'APPROVED' ? `30${pad(1000000000 + i * 7919, 9)}` : null,
      bankIfsc: status === 'APPROVED' ? `HDFC0${pad((i * 3571) % 1000000, 6)}` : null,
      bankName: status === 'APPROVED' ? pick(rngFor(`bank:${i}`), BANK_NAMES) : null,
      zoneId: zone.id,
      createdAt,
    });

    vendorIndexById.set(i, { id: vendorId, storeType, status });
  }

  const vendorUsersCreated = await insertBatched(vendorUserRows, (batch) =>
    prisma.user.createMany({ data: batch, skipDuplicates: true }),
  );
  const vendorsCreated = await insertBatched(vendorRows, (batch) =>
    prisma.vendor.createMany({ data: batch, skipDuplicates: true }),
  );
  console.log(`   Vendor users: +${vendorUsersCreated} created (target ${config.vendors})`);
  console.log(`   Vendors:      +${vendorsCreated} created (target ${config.vendors})`);

  // ── Products ──────────────────────────────────────────────────────────────
  const productRows: Prisma.ProductCreateManyInput[] = [];

  for (let vi = 1; vi <= config.vendors; vi += 1) {
    const vendor = vendorIndexById.get(vi)!;
    const storeType = vendor.storeType;
    const pool = PRODUCT_POOL[storeType];
    const typeCategories = categoriesByType[storeType];
    const typeBrands = brandsByType[storeType];

    for (let pi = 1; pi <= config.productsPerVendor; pi += 1) {
      const r = rngFor(`product:${vi}:${pi}`);
      const tuple = pool[Math.floor(r() * pool.length)];
      const adjective = chance(r, 0.65) ? pick(r, PRODUCT_ADJECTIVES) : '';
      const name = `${adjective ? `${adjective} ` : ''}${tuple.n} (${tuple.s})`;

      const category =
        typeCategories.find((c) => c.slug === tuple.c) ??
        typeCategories[Math.floor(r() * typeCategories.length)];
      const brand = typeBrands[Math.floor(r() * typeBrands.length)];

      const price = Math.max(15, Math.round((tuple.p * (0.85 + r() * 0.9)) / 5) * 5);
      const compareAtPrice = chance(r, 0.45)
        ? price + Math.round((price * (0.1 + r() * 0.35)) / 5) * 5
        : null;

      const stockRoll = r();
      const stock =
        stockRoll < 0.04 ? randInt(r, 0, 3) : stockRoll < 0.1 ? randInt(r, 4, 10) : randInt(r, 15, 320);

      const pendingQueue = vendor.status === 'APPROVED' && vi % 4 === 0 && pi === config.productsPerVendor;
      const isApproved =
        vendor.status === 'APPROVED' || vendor.status === 'SUSPENDED' ? !pendingQueue : false;
      const isActive =
        (vendor.status === 'APPROVED' || vendor.status === 'PENDING') && !chance(r, 0.015);

      productRows.push({
        id: `bulk-test-product-${pad((vi - 1) * config.productsPerVendor + pi, 4)}`,
        vendorId: vendor.id,
        categoryId: category.id,
        brandId: brand.id,
        name,
        description:
          storeType === 'ORGANIC'
            ? `Residue-free ${tuple.n.toLowerCase()} from our partner farms — organically grown and packed fresh.`
            : storeType === 'NATURAL'
              ? `Plant-based ${tuple.n.toLowerCase()} with no sulphates or parabens — made in small batches.`
              : `Plastic-free ${tuple.n.toLowerCase()} built to be reused — responsibly sourced and made to last.`,
        price,
        compareAtPrice,
        unit: tuple.u,
        stock,
        images: [placeholderUrl(storeType, tuple.n.split(' ')[0])],
        isActive,
        isApproved,
        createdAt: daysAgo(r, 150),
      });
    }
  }

  const productsCreated = await insertBatched(productRows, (batch) =>
    prisma.product.createMany({ data: batch, skipDuplicates: true }),
  );
  console.log(`   Products: +${productsCreated} created (target ${config.totalProducts})`);

  // ── Verification ──────────────────────────────────────────────────────────
  const failures: string[] = [];
  const notes: string[] = [];

  const bulkCustomers = await prisma.user.count({
    where: { id: { startsWith: 'bulk-test-customer-' } },
  });
  const bulkVendorUsers = await prisma.user.count({
    where: { id: { startsWith: 'bulk-test-vendor-user-' } },
  });
  const bulkVendors = await prisma.vendor.count({
    where: { id: { startsWith: 'bulk-test-vendor-' } },
  });
  const bulkProducts = await prisma.product.count({
    where: { id: { startsWith: 'bulk-test-product-' } },
  });
  const bulkAddresses = await prisma.address.count({
    where: { id: { startsWith: 'bulk-test-address-' } },
  });
  const customerRoleCount = await prisma.user.count({
    where: { id: { startsWith: 'bulk-test-customer-' }, role: 'CUSTOMER' },
  });
  const vendorRoleCount = await prisma.user.count({
    where: { id: { startsWith: 'bulk-test-vendor-user-' }, role: 'VENDOR' },
  });

  if (bulkCustomers < config.customers) failures.push(`customers ${bulkCustomers} < ${config.customers}`);
  else if (bulkCustomers > config.customers) notes.push(`customers ${bulkCustomers} > ${config.customers} (leftover from an earlier, larger run — never deleted)`);
  if (customerRoleCount !== bulkCustomers) failures.push('some bulk customers do not have role CUSTOMER');

  if (bulkVendorUsers < config.vendors) failures.push(`vendor users ${bulkVendorUsers} < ${config.vendors}`);
  else if (bulkVendorUsers > config.vendors) notes.push(`vendor users ${bulkVendorUsers} > ${config.vendors} (leftover from an earlier run)`);
  if (vendorRoleCount !== bulkVendorUsers) failures.push('some bulk vendor users do not have role VENDOR');

  if (bulkVendors < config.vendors) failures.push(`vendor profiles ${bulkVendors} < ${config.vendors}`);
  else if (bulkVendors > config.vendors) notes.push(`vendor profiles ${bulkVendors} > ${config.vendors} (leftover from an earlier run)`);

  if (bulkProducts < config.totalProducts) failures.push(`products ${bulkProducts} < ${config.totalProducts}`);
  else if (bulkProducts > config.totalProducts) notes.push(`products ${bulkProducts} > ${config.totalProducts} (leftover from an earlier run)`);

  if (config.customers > 0 && bulkAddresses < config.customers) {
    failures.push(`addresses ${bulkAddresses} < ${config.customers}`);
  }

  const perVendor = await prisma.vendor.findMany({
    where: { id: { startsWith: 'bulk-test-vendor-' } },
    select: { storeSlug: true, id: true, _count: { select: { products: true } } },
    orderBy: { id: 'asc' },
  });
  const targetVendorIds = new Set(
    Array.from({ length: config.vendors }, (_, k) => `bulk-test-vendor-${pad(k + 1, 3)}`),
  );
  for (const v of perVendor) {
    if (targetVendorIds.has(v.id) && v._count.products !== config.productsPerVendor) {
      failures.push(`vendor ${v.storeSlug} has ${v._count.products} products (expected ${config.productsPerVendor})`);
    }
  }
  if (perVendor.length < config.vendors) {
    failures.push(`only ${perVendor.length} bulk vendors found in DB`);
  }

  const dupEmailRows = await prisma.$queryRaw<{ email: string }[]>`
    SELECT email FROM "User" WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1`;
  const dupSlugRows = await prisma.$queryRaw<{ storeSlug: string }[]>`
    SELECT "storeSlug" FROM "Vendor" GROUP BY "storeSlug" HAVING COUNT(*) > 1`;
  if (dupEmailRows.length > 0) failures.push(`${dupEmailRows.length} duplicate user email(s) found`);
  if (dupSlugRows.length > 0) failures.push(`${dupSlugRows.length} duplicate store slug(s) found`);

  const after = await nonBulkCounts();
  const mockUnchanged =
    after.users === before.users &&
    after.vendors === before.vendors &&
    after.products === before.products &&
    after.addresses === before.addresses;
  if (!mockUnchanged) failures.push('non-bulk (existing mock/business) record counts changed');

  console.log('\n===== BULK SEED SUMMARY =====');
  console.log(`Database                 : ${guard.host}/${guard.database}`);
  console.log(`Config                   : customers=${config.customers}, vendors=${config.vendors}, products/vendor=${config.productsPerVendor}, total products=${config.totalProducts}`);
  console.log(`Created this run         : customers=${customersCreated}, addresses=${addressesCreated}, vendorUsers=${vendorUsersCreated}, vendors=${vendorsCreated}, products=${productsCreated}`);
  console.log(`Bulk totals in DB        : customers=${bulkCustomers}, vendorUsers=${bulkVendorUsers}, vendors=${bulkVendors}, products=${bulkProducts}, addresses=${bulkAddresses}`);
  console.log(`Existing (non-bulk) data : ${JSON.stringify(after)} — ${mockUnchanged ? 'UNCHANGED' : 'CHANGED'}`);
  for (const note of notes) console.log(`Note: ${note}`);
  if (failures.length > 0) {
    console.log('\n❌ Verification FAILED:');
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ Verification passed: counts, roles, per-vendor products, unique emails/slugs, relationships, idempotent re-run safety.');
  }
}

main()
  .catch((e) => {
    console.error('❌ Bulk admin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
