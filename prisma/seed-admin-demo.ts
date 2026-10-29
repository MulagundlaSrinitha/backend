import {
  PrismaClient,
  StoreType,
  UserRole,
  VendorStatus,
} from '@prisma/client';

// =============================================================================
// Next360 - Admin Dashboard MOCK DATA seed
// -----------------------------------------------------------------------------
// Creates fictional demo data for development/testing of the admin panel:
//   - 20 users (10 VENDOR + 8 CUSTOMER + 1 ADMIN + 1 DELIVERY_PARTNER)
//   - 10 vendors (one per VENDOR user)
//   - 150 products (exactly 15 per vendor)
//
// Idempotent by natural keys: zones/categories/brands/users/vendors are
// upserted or skipped when they already exist, and a vendor's products are
// only created when that vendor currently has zero products (prevents
// duplicates on re-run).
//
// Run (from repo root, using the repo's Prisma client):
//   npx ts-node prisma/seed-admin-demo.ts
// =============================================================================

const prisma = new PrismaClient();

// ── Zones ────────────────────────────────────────────────────────────────────
// Convention from prisma/seed.ts: zone primary key equals the city name.
const ZONES = [
  { id: 'Hyderabad', name: 'Hyderabad', city: 'Hyderabad', pincodes: ['500001', '500034', '500081', '500032'] },
  { id: 'Vijayawada', name: 'Vijayawada', city: 'Vijayawada', pincodes: ['520001', '520002', '520007', '520010'] },
] as const;

// ── Categories (upserted by slug + storeType) ────────────────────────────────
const CATEGORIES: Record<StoreType, { slug: string; name: string; description: string }[]> = {
  ORGANIC: [
    { slug: 'fresh-organic-produce', name: 'Fresh Organic Produce', description: 'Certified organic fruits and vegetables' },
    { slug: 'organic-grains-pulses', name: 'Organic Grains & Pulses', description: 'Organic cereals, grains and dals' },
    { slug: 'organic-dairy-eggs', name: 'Organic Dairy & Eggs', description: 'Grass-fed dairy and free-range eggs' },
    { slug: 'organic-beverages', name: 'Organic Beverages', description: 'Organic juices, teas and infusions' },
    { slug: 'organic-pantry', name: 'Organic Pantry', description: 'Honey, nuts, oils and pantry staples' },
  ],
  NATURAL: [
    { slug: 'natural-skincare', name: 'Natural Skincare', description: 'Plant-based skincare formulations' },
    { slug: 'natural-haircare', name: 'Natural Haircare', description: 'Herbal haircare without sulphates' },
    { slug: 'natural-wellness', name: 'Natural Wellness', description: 'Ayurvedic wellness supplements' },
    { slug: 'natural-home', name: 'Natural Home & Living', description: 'Botanical home fragrances and care' },
    { slug: 'natural-personal-care', name: 'Natural Personal Care', description: 'Natural soaps, clays and body care' },
  ],
  ECO_FRIENDLY: [
    { slug: 'ecofriendly-kitchen', name: 'Eco-Friendly Kitchen', description: 'Reusable kitchen essentials' },
    { slug: 'ecofriendly-cleaning', name: 'Eco-Friendly Cleaning', description: 'Plastic-free cleaning products' },
    { slug: 'ecofriendly-reusable', name: 'Reusable & Reusables', description: 'Zero-waste everyday swaps' },
    { slug: 'ecofriendly-clothing', name: 'Sustainable Clothing', description: 'Organic fibre apparel and bags' },
    { slug: 'ecofriendly-home-decor', name: 'Eco Home Decor', description: 'Handcrafted natural home decor' },
  ],
};

// ── Brands (upserted by slug) ────────────────────────────────────────────────
const BRANDS: Record<StoreType, { slug: string; name: string; description: string }[]> = {
  ORGANIC: [
    { slug: 'bhoomi-harvest', name: 'Bhoomi Harvest', description: 'Single-origin certified organic farm produce' },
    { slug: 'amrut-earth', name: 'Amrut Earth', description: 'Organic pantry and dairy from small farms' },
  ],
  NATURAL: [
    { slug: 'arogya-botanics', name: 'Arogya Botanics', description: 'Ayurvedic botanicals for daily rituals' },
    { slug: 'pura-vida-essentials', name: 'Pura Vida Essentials', description: 'Clean natural personal care' },
  ],
  ECO_FRIENDLY: [
    { slug: 'releaf-goods', name: 'ReLeaf Goods', description: 'Zero-waste household essentials' },
    { slug: 'terranest-studio', name: 'TerraNest Studio', description: 'Handcrafted sustainable home ware' },
  ],
};

// ── Users (20) ───────────────────────────────────────────────────────────────
// Phone numbers use the fictional +91 91000-0000xx block to stay unique.
const USERS: { email: string; name: string; phone: string; role: UserRole }[] = [
  // Vendor users (10) — one per Vendor record below
  { email: 'sarita.deepak@next360demo.com', name: 'Sarita Deepak', phone: '+919100000001', role: UserRole.VENDOR },
  { email: 'ramesh.patel@next360demo.com', name: 'Ramesh Patel', phone: '+919100000002', role: UserRole.VENDOR },
  { email: 'kavita.iyer@next360demo.com', name: 'Kavita Iyer', phone: '+919100000003', role: UserRole.VENDOR },
  { email: 'vikas.reddy@next360demo.com', name: 'Vikas Reddy', phone: '+919100000004', role: UserRole.VENDOR },
  { email: 'anita.desai@next360demo.com', name: 'Anita Desai', phone: '+919100000005', role: UserRole.VENDOR },
  { email: 'karthik.s@next360demo.com', name: 'Karthik Subramaniam', phone: '+919100000006', role: UserRole.VENDOR },
  { email: 'meera.nair@next360demo.com', name: 'Meera Nair', phone: '+919100000007', role: UserRole.VENDOR },
  { email: 'rajan.verma@next360demo.com', name: 'Rajan Verma', phone: '+919100000008', role: UserRole.VENDOR },
  { email: 'divya.shetty@next360demo.com', name: 'Divya Shetty', phone: '+919100000009', role: UserRole.VENDOR },
  { email: 'sanjay.kulkarni@next360demo.com', name: 'Sanjay Kulkarni', phone: '+919100000010', role: UserRole.VENDOR },
  // Customers (8)
  { email: 'ananya.roy@next360demo.com', name: 'Ananya Roy', phone: '+919100000011', role: UserRole.CUSTOMER },
  { email: 'praneeth.g@next360demo.com', name: 'Praneeth Goud', phone: '+919100000012', role: UserRole.CUSTOMER },
  { email: 'shruti.agarwal@next360demo.com', name: 'Shruti Agarwal', phone: '+919100000013', role: UserRole.CUSTOMER },
  { email: 'imran.khan@next360demo.com', name: 'Imran Khan', phone: '+919100000014', role: UserRole.CUSTOMER },
  { email: 'lakshmi.prasad@next360demo.com', name: 'Lakshmi Prasad', phone: '+919100000015', role: UserRole.CUSTOMER },
  { email: 'nikhil.menon@next360demo.com', name: 'Nikhil Menon', phone: '+919100000016', role: UserRole.CUSTOMER },
  { email: 'pooja.singh@next360demo.com', name: 'Pooja Singh', phone: '+919100000017', role: UserRole.CUSTOMER },
  { email: 'arjun.bhatt@next360demo.com', name: 'Arjun Bhatt', phone: '+919100000018', role: UserRole.CUSTOMER },
  // Admin (1)
  { email: 'demo.admin@next360demo.com', name: 'Demo Administrator', phone: '+919100000019', role: UserRole.ADMIN },
  // Delivery partner (1)
  { email: 'suresh.kumar@next360demo.com', name: 'Suresh Kumar', phone: '+919100000020', role: UserRole.DELIVERY_PARTNER },
];

// ── Vendors (10) ─────────────────────────────────────────────────────────────
interface VendorSeed {
  userEmail: string;
  storeName: string;
  storeSlug: string;
  storeType: StoreType;
  zoneId: string;
  status: VendorStatus;
  ownerName: string;
  description: string;
  city: string;
  state: string;
  pincode: string;
  commissionPct: number;
}

const VENDORS: VendorSeed[] = [
  { userEmail: USERS[0].email, storeName: 'GreenRoot Organic Farms', storeSlug: 'greenroot-organic-farms', storeType: 'ORGANIC', zoneId: 'Hyderabad', status: 'APPROVED', ownerName: 'Sarita Deepak', description: 'Certified organic seasonal produce from Telangana farms', city: 'Hyderabad', state: 'Telangana', pincode: '500081', commissionPct: 15 },
  { userEmail: USERS[1].email, storeName: 'Sattva Naturals', storeSlug: 'sattva-naturals', storeType: 'NATURAL', zoneId: 'Hyderabad', status: 'APPROVED', ownerName: 'Ramesh Patel', description: 'Ayurvedic skincare and wellness made the traditional way', city: 'Hyderabad', state: 'Telangana', pincode: '500034', commissionPct: 14 },
  { userEmail: USERS[2].email, storeName: 'TerraNest Eco Goods', storeSlug: 'terranest-eco-goods', storeType: 'ECO_FRIENDLY', zoneId: 'Hyderabad', status: 'APPROVED', ownerName: 'Kavita Iyer', description: 'Zero-waste kitchen and cleaning essentials', city: 'Hyderabad', state: 'Telangana', pincode: '500032', commissionPct: 15 },
  { userEmail: USERS[3].email, storeName: 'Amrut Vanam Organics', storeSlug: 'amrut-vanam-organics', storeType: 'ORGANIC', zoneId: 'Vijayawada', status: 'APPROVED', ownerName: 'Vikas Reddy', description: 'Organic grains and pulses from Krishna delta farms', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001', commissionPct: 13 },
  { userEmail: USERS[4].email, storeName: 'Arogya Rasayanas', storeSlug: 'arogya-rasayanas', storeType: 'NATURAL', zoneId: 'Vijayawada', status: 'APPROVED', ownerName: 'Anita Desai', description: 'Natural wellness supplements and botanical oils', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520007', commissionPct: 14 },
  { userEmail: USERS[5].email, storeName: 'Verdant Living Co.', storeSlug: 'verdant-living-co', storeType: 'ECO_FRIENDLY', zoneId: 'Vijayawada', status: 'APPROVED', ownerName: 'Karthik Subramaniam', description: 'Sustainable apparel and fibre bags', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520010', commissionPct: 12 },
  { userEmail: USERS[6].email, storeName: 'Bhoomi Organics', storeSlug: 'bhoomi-organics', storeType: 'ORGANIC', zoneId: 'Hyderabad', status: 'PENDING', ownerName: 'Meera Nair', description: 'New farm collective pending admin approval', city: 'Hyderabad', state: 'Telangana', pincode: '500050', commissionPct: 15 },
  { userEmail: USERS[7].email, storeName: 'Prana Wellness Studio', storeSlug: 'prana-wellness-studio', storeType: 'NATURAL', zoneId: 'Hyderabad', status: 'APPROVED', ownerName: 'Rajan Verma', description: 'Herbal teas, herbs and personal care', city: 'Hyderabad', state: 'Telangana', pincode: '500016', commissionPct: 13 },
  { userEmail: USERS[8].email, storeName: 'ReLeaf Sustainability', storeSlug: 'releaf-sustainability', storeType: 'ECO_FRIENDLY', zoneId: 'Hyderabad', status: 'SUSPENDED', ownerName: 'Divya Shetty', description: 'Suspended pending compliance review', city: 'Hyderabad', state: 'Telangana', pincode: '500045', commissionPct: 12 },
  { userEmail: USERS[9].email, storeName: 'Organic Roots Collective', storeSlug: 'organic-roots-collective', storeType: 'ORGANIC', zoneId: 'Vijayawada', status: 'REJECTED', ownerName: 'Sanjay Kulkarni', description: 'Application rejected after KYC shortfall', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520002', commissionPct: 15 },
];

// ── Product catalog (15 per store type, reused across vendors of that type) ──
interface ProductSeed {
  name: string;
  unit: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  categorySlug: string;
  description: string;
}

const PRODUCTS: Record<StoreType, ProductSeed[]> = {
  ORGANIC: [
    { name: 'Organic Banana (1 dozen)', unit: 'dozen', price: 110, compareAtPrice: 130, stock: 120, categorySlug: 'fresh-organic-produce', description: 'Sweet, chemical-free organic bananas from local farms' },
    { name: 'Organic Spinach (500g)', unit: 'bunch', price: 45, stock: 150, categorySlug: 'fresh-organic-produce', description: 'Fresh-picked organic spinach bunches' },
    { name: 'Organic Cherry Tomatoes (250g)', unit: 'pack', price: 65, stock: 90, categorySlug: 'fresh-organic-produce', description: 'Juicy organic cherry tomatoes' },
    { name: 'Organic Brown Rice (2kg)', unit: 'kg', price: 210, compareAtPrice: 250, stock: 80, categorySlug: 'organic-grains-pulses', description: 'Unpolished organic brown basmati rice' },
    { name: 'Moong Dal Splits (1kg)', unit: 'kg', price: 160, stock: 75, categorySlug: 'organic-grains-pulses', description: 'Certified organic yellow moong dal' },
    { name: 'Whole Wheat Atta (5kg)', unit: 'kg', price: 380, stock: 60, categorySlug: 'organic-grains-pulses', description: 'Stone-ground organic whole wheat flour' },
    { name: 'Quinoa (500g)', unit: 'pack', price: 290, compareAtPrice: 340, stock: 45, categorySlug: 'organic-grains-pulses', description: 'Protein-rich organic quinoa' },
    { name: 'A2 Cow Milk (1L)', unit: 'litre', price: 90, stock: 200, categorySlug: 'organic-dairy-eggs', description: 'Fresh farm A2 cow milk, cold chain delivered' },
    { name: 'Free-Range Eggs (12)', unit: 'dozen', price: 125, stock: 110, categorySlug: 'organic-dairy-eggs', description: 'Free-range organic eggs' },
    { name: 'Grass-Fed Ghee (500ml)', unit: 'jar', price: 620, compareAtPrice: 700, stock: 40, categorySlug: 'organic-dairy-eggs', description: 'Slow-churned grass-fed desi ghee' },
    { name: 'Raw Forest Honey (500g)', unit: 'jar', price: 450, stock: 55, categorySlug: 'organic-pantry', description: 'Unprocessed raw forest honey' },
    { name: 'Cold-Pressed Fruit Juice (1L)', unit: 'litre', price: 130, stock: 70, categorySlug: 'organic-beverages', description: 'Cold-pressed seasonal fruit juice, no preservatives' },
    { name: 'Herbal Green Tea (25 bags)', unit: 'box', price: 145, stock: 85, categorySlug: 'organic-beverages', description: 'Organic tulsi-infused green tea' },
    { name: 'Mixed Nuts Trail Mix (400g)', unit: 'pack', price: 380, compareAtPrice: 420, stock: 65, categorySlug: 'organic-pantry', description: 'Roasted organic almonds, cashews and raisins' },
    { name: 'Gherkin Pickle (300g)', unit: 'jar', price: 95, stock: 95, categorySlug: 'organic-pantry', description: 'Home-style organic gherkin pickle' },
  ],
  NATURAL: [
    { name: 'Aloe Vera Face Gel (200ml)', unit: 'bottle', price: 260, compareAtPrice: 300, stock: 80, categorySlug: 'natural-skincare', description: 'Pure cold-pressed aloe vera gel for all skin types' },
    { name: 'Neem & Tulsi Face Wash (150ml)', unit: 'bottle', price: 185, stock: 95, categorySlug: 'natural-skincare', description: 'Herbal face wash with neem and tulsi' },
    { name: 'Sandalwood Face Pack (150g)', unit: 'box', price: 230, stock: 60, categorySlug: 'natural-skincare', description: 'Traditional sandalwood face pack powder' },
    { name: 'Amla Hair Oil (200ml)', unit: 'bottle', price: 240, compareAtPrice: 280, stock: 75, categorySlug: 'natural-haircare', description: 'Cold-pressed amla oil for stronger roots' },
    { name: 'Shikakai Shampoo Bar (75g)', unit: 'bar', price: 120, stock: 110, categorySlug: 'natural-haircare', description: 'Sulphate-free shikakai shampoo bar' },
    { name: 'Bhringraj Hair Serum (100ml)', unit: 'bottle', price: 320, stock: 50, categorySlug: 'natural-haircare', description: 'Bhringraj and amla hair growth serum' },
    { name: 'Ashwagandha Capsules (60)', unit: 'box', price: 380, compareAtPrice: 430, stock: 55, categorySlug: 'natural-wellness', description: 'Standardised organic ashwagandha root extract' },
    { name: 'Triphala Powder (200g)', unit: 'box', price: 210, stock: 65, categorySlug: 'natural-wellness', description: 'Classic triphala digestive powder' },
    { name: 'Tulsi Drops (30ml)', unit: 'bottle', price: 130, stock: 120, categorySlug: 'natural-wellness', description: 'Concentrated holy basil extract drops' },
    { name: 'Ayurvedic Body Massage Oil (300ml)', unit: 'bottle', price: 340, compareAtPrice: 390, stock: 45, categorySlug: 'natural-wellness', description: 'Sesame-based herbal massage oil' },
    { name: 'Camphor Tablets (100g)', unit: 'box', price: 85, stock: 130, categorySlug: 'natural-home', description: 'Pure natural camphor for home rituals' },
    { name: 'Lemongrass Reed Diffuser (100ml)', unit: 'bottle', price: 290, stock: 40, categorySlug: 'natural-home', description: 'Alcohol-free lemongrass reed diffuser' },
    { name: 'Lavender Essential Oil (10ml)', unit: 'bottle', price: 420, compareAtPrice: 480, stock: 35, categorySlug: 'natural-home', description: 'Steam-distilled pure lavender oil' },
    { name: 'Sandalwood Soap (3 bars)', unit: 'pack', price: 240, stock: 70, categorySlug: 'natural-personal-care', description: 'Handcrafted sandalwood soap bars' },
    { name: 'Multani Mitti Clay (200g)', unit: 'box', price: 95, stock: 100, categorySlug: 'natural-personal-care', description: 'Natural fuller\'s earth clay for skin' },
  ],
  ECO_FRIENDLY: [
    { name: 'Stainless Steel Lunch Box', unit: 'piece', price: 480, compareAtPrice: 560, stock: 40, categorySlug: 'ecofriendly-kitchen', description: 'Leak-proof stainless steel lunch box' },
    { name: 'Bamboo Cutlery Set (6 pc)', unit: 'set', price: 360, stock: 55, categorySlug: 'ecofriendly-kitchen', description: 'Reusable bamboo cutlery set with carry pouch' },
    { name: 'Copper Water Bottle (1L)', unit: 'piece', price: 750, compareAtPrice: 850, stock: 30, categorySlug: 'ecofriendly-kitchen', description: 'Handmade copper water bottle, Ayurveda housing' },
    { name: 'Jute Grocery Bags (5 pc)', unit: 'set', price: 280, stock: 90, categorySlug: 'ecofriendly-reusable', description: 'Sturdy jute shopping bags with cotton liners' },
    { name: 'Reusable Beeswax Wraps (3 pc)', unit: 'set', price: 450, stock: 35, categorySlug: 'ecofriendly-reusable', description: 'Organic cotton beeswax food wraps' },
    { name: 'Metal Straws Set (8 pc)', unit: 'set', price: 220, stock: 85, categorySlug: 'ecofriendly-reusable', description: 'Stainless steel straw set with cleaning brush' },
    { name: 'Natural Dishwash Bar (200g)', unit: 'bar', price: 150, stock: 70, categorySlug: 'ecofriendly-cleaning', description: 'Plastic-free coconut-oil dishwash bar' },
    { name: 'Coconut Fibre Scrub Brush', unit: 'piece', price: 140, stock: 95, categorySlug: 'ecofriendly-cleaning', description: 'Compostable coconut fibre cleaning brush' },
    { name: 'Baking Soda Cleaner (500g)', unit: 'box', price: 120, stock: 110, categorySlug: 'ecofriendly-cleaning', description: 'Multi-surface natural baking soda cleaner' },
    { name: 'Organic Cotton T-Shirt', unit: 'piece', price: 620, compareAtPrice: 700, stock: 25, categorySlug: 'ecofriendly-clothing', description: 'Unbleached organic cotton everyday t-shirt' },
    { name: 'Hemp Tote Backpack', unit: 'piece', price: 1150, compareAtPrice: 1300, stock: 15, categorySlug: 'ecofriendly-clothing', description: 'Durable hemp-fibre backpack, eco-tanned' },
    { name: 'Bamboo Socks (pair)', unit: 'pair', price: 180, stock: 60, categorySlug: 'ecofriendly-clothing', description: 'Breathable bamboo-fibre socks' },
    { name: 'Clay Pot Planter (medium)', unit: 'piece', price: 330, stock: 45, categorySlug: 'ecofriendly-home-decor', description: 'Hand-thrown terracotta planter' },
    { name: 'Rattan Wall Basket', unit: 'piece', price: 540, compareAtPrice: 620, stock: 22, categorySlug: 'ecofriendly-home-decor', description: 'Handwoven rattan wall basket' },
    { name: 'Terracotta Tea-Light Holders (4 pc)', unit: 'set', price: 380, stock: 32, categorySlug: 'ecofriendly-home-decor', description: 'Matte terracotta tea-light holders' },
  ],
};

// Placeholder accent per store type (matches the app's category swatch theming)
const ACCENTS: Record<StoreType, { bg: string; fg: string }> = {
  ORGANIC: { bg: 'EDF0E8', fg: '5C6B4D' },
  NATURAL: { bg: 'F4ECE3', fg: '9B6A3F' },
  ECO_FRIENDLY: { bg: 'E7EEEE', fg: '2F5D62' },
};

function placeholderUrl(storeType: StoreType, label: string): string {
  const { bg, fg } = ACCENTS[storeType];
  return `https://placehold.co/400x400/${bg}/${fg}?text=${encodeURIComponent(label)}`;
}

// Vendors whose first product should be left unapproved (admin approvals queue)
const PENDING_APPROVAL_VENDOR_INDEXES = new Set([1, 5, 7]);
const SUSPENDED_VENDOR_INDEX = 8;

async function main() {
  console.log('🌱 Seeding Admin Dashboard mock data (10 vendors / 150 products / 20 users)...');

  // 1. Zones
  const zoneIds: string[] = [];
  for (const zone of ZONES) {
    await prisma.zone.upsert({
      where: { id: zone.id },
      update: { name: zone.name, city: zone.city, pincodes: zone.pincodes as unknown as string[] },
      create: { id: zone.id, name: zone.name, city: zone.city, pincodes: zone.pincodes as unknown as string[] },
    });
    zoneIds.push(zone.id);
  }
  console.log(`   Zones ensured: ${zoneIds.join(', ')}`);

  // 2. Categories
  const categoriesBySlug: Record<string, string> = {};
  for (const storeType of Object.keys(CATEGORIES) as StoreType[]) {
    for (const cat of CATEGORIES[storeType]) {
      const record = await prisma.category.upsert({
        where: { slug_storeType: { slug: cat.slug, storeType } },
        update: { name: cat.name, description: cat.description },
        create: { slug: cat.slug, name: cat.name, description: cat.description, storeType },
      });
      categoriesBySlug[cat.slug] = record.id;
    }
  }
  console.log(`   Categories ensured: ${Object.keys(categoriesBySlug).length}`);

  // 3. Brands
  const brandsBySlug: Record<string, string> = {};
  for (const storeType of Object.keys(BRANDS) as StoreType[]) {
    for (const brand of BRANDS[storeType]) {
      const record = await prisma.brand.upsert({
        where: { slug: brand.slug },
        update: { name: brand.name, description: brand.description },
        create: { slug: brand.slug, name: brand.name, description: brand.description, storeType },
      });
      brandsBySlug[brand.slug] = record.id;
    }
  }
  console.log(`   Brands ensured: ${Object.keys(brandsBySlug).length}`);

  // 4. Users
  const userByEmail: Record<string, string> = {};
  let usersCreated = 0;
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      userByEmail[u.email] = existing.id;
      continue;
    }
    const created = await prisma.user.create({
      data: { email: u.email, name: u.name, phone: u.phone, role: u.role },
    });
    userByEmail[u.email] = created.id;
    usersCreated += 1;
  }
  console.log(`   Users: ${usersCreated} created, ${USERS.length - usersCreated} already existed`);

  // 5. Vendors
  const vendorIds: string[] = [];
  let vendorsCreated = 0;
  for (const v of VENDORS) {
    const existing = await prisma.vendor.findUnique({ where: { storeSlug: v.storeSlug } });
    if (existing) {
      vendorIds.push(existing.id);
      continue;
    }
    const created = await prisma.vendor.create({
      data: {
        userId: userByEmail[v.userEmail],
        storeName: v.storeName,
        storeSlug: v.storeSlug,
        storeType: v.storeType,
        zoneId: v.zoneId,
        status: v.status,
        ownerName: v.ownerName,
        description: v.description,
        city: v.city,
        state: v.state,
        pincode: v.pincode,
        commissionPct: v.commissionPct,
        deliveryTimeMin: 15,
        deliveryTimeMax: 35,
        deliveryLabel: 'Hand-delivered from farm/store',
      },
    });
    vendorIds.push(created.id);
    vendorsCreated += 1;
  }
  console.log(`   Vendors: ${vendorsCreated} created, ${VENDORS.length - vendorsCreated} already existed`);

  // 6. Products (exactly 15 per vendor; skipped when vendor already has products)
  let productsCreated = 0;
  for (let vi = 0; vi < VENDORS.length; vi += 1) {
    const vendorSeed = VENDORS[vi];
    const vendorId = vendorIds[vi];

    const existingProducts = await prisma.product.count({ where: { vendorId } });
    if (existingProducts > 0) {
      console.log(`   Vendor "${vendorSeed.storeName}": already has ${existingProducts} products — skipping`);
      continue;
    }

    const catalog = PRODUCTS[vendorSeed.storeType];
    const storeBrands = BRANDS[vendorSeed.storeType];

    for (let pi = 0; pi < catalog.length; pi += 1) {
      const p = catalog[pi];
      const isSuspended = vi === SUSPENDED_VENDOR_INDEX;
      const pendingApproval = !isSuspended && PENDING_APPROVAL_VENDOR_INDEXES.has(vi) && pi === 0;

      await prisma.product.create({
        data: {
          vendorId,
          categoryId: categoriesBySlug[p.categorySlug],
          brandId: brandsBySlug[storeBrands[pi % storeBrands.length].slug],
          name: p.name,
          description: p.description,
          price: p.price,
          compareAtPrice: p.compareAtPrice ?? null,
          unit: p.unit,
          stock: p.stock,
          images: [placeholderUrl(vendorSeed.storeType, p.name.split(' ')[0])],
          isActive: !isSuspended,
          isApproved: !pendingApproval,
        },
      });
      productsCreated += 1;
    }
    console.log(`   Vendor "${vendorSeed.storeName}": +15 products`);
  }

  // 7. Summary + post-seed verification counts
  const [userCount, vendorCount, productCount, perVendor] = await Promise.all([
    prisma.user.count(),
    prisma.vendor.count(),
    prisma.product.count(),
    prisma.vendor.findMany({
      select: { storeName: true, _count: { select: { products: true } } },
      orderBy: { storeName: 'asc' },
    }),
  ]);

  console.log('\n===== MOCK DATA SUMMARY =====');
  console.log(`Users created this run : ${usersCreated}`);
  console.log(`Vendors created this run: ${vendorsCreated}`);
  console.log(`Products created this run: ${productsCreated}`);
  console.log(`\nDB totals: users=${userCount}, vendors=${vendorCount}, products=${productCount}`);
  console.log('Products per vendor:');
  for (const v of perVendor) {
    console.log(`   ${v.storeName}: ${v._count.products}`);
  }

  console.log('\n✅ Admin Dashboard mock seed completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Admin Dashboard mock seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });