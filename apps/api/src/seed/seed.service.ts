import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SeedService {
  private readonly logger = new Logger('SeedService');

  constructor(private readonly prisma: PrismaService) {}

  async seed() {
    this.logger.log('Starting database seed...');

    // Check if data already exists
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      this.logger.warn('Database already has data. Skipping seed.');
      return { message: 'Database already seeded', skipped: true };
    }

    try {
      // 0. Create Zone (required for Vendors and Addresses)
      this.logger.log('Creating zones...');
      const hyderabadZone = await this.prisma.zone.create({
        data: { name: 'Hyderabad', city: 'Hyderabad', isActive: true },
      });

      // 1. Create Users (auth is via Supabase; no password field on User model)
      this.logger.log('Creating users...');

      const admin = await this.prisma.user.create({
        data: {
          email: 'admin@next360.com',
          name: 'Admin User',
          phone: '+919876543210',
          role: 'ADMIN',
        },
      });

      const vendorUsers = await Promise.all([
        this.prisma.user.create({
          data: {
            email: 'organic@next360.com',
            name: 'Green Earth Organics',
            phone: '+919876543211',
            role: 'VENDOR',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'natural@next360.com',
            name: 'Pure Natural Living',
            phone: '+919876543212',
            role: 'VENDOR',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'eco@next360.com',
            name: 'Eco Harmony Store',
            phone: '+919876543213',
            role: 'VENDOR',
          },
        }),
      ]);

      const customerUsers = await Promise.all([
        this.prisma.user.create({
          data: {
            email: 'customer1@next360.com',
            name: 'Rahul Sharma',
            phone: '+919876543214',
            role: 'CUSTOMER',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'customer2@next360.com',
            name: 'Priya Patel',
            phone: '+919876543215',
            role: 'CUSTOMER',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'customer3@next360.com',
            name: 'Amit Kumar',
            phone: '+919876543216',
            role: 'CUSTOMER',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'customer4@next360.com',
            name: 'Sneha Reddy',
            phone: '+919876543217',
            role: 'CUSTOMER',
          },
        }),
      ]);

      const deliveryUsers = await Promise.all([
        this.prisma.user.create({
          data: {
            email: 'delivery1@next360.com',
            name: 'Rajesh Delivery',
            phone: '+919876543218',
            role: 'DELIVERY_PARTNER',
          },
        }),
        this.prisma.user.create({
          data: {
            email: 'delivery2@next360.com',
            name: 'Suresh Delivery',
            phone: '+919876543219',
            role: 'DELIVERY_PARTNER',
          },
        }),
      ]);

      // 2. Create Categories
      this.logger.log('Creating categories...');
      const organicCategories = await Promise.all([
        this.prisma.category.create({
          data: { name: 'Fresh Fruits', slug: 'fresh-fruits', storeType: 'ORGANIC', description: 'Certified organic fresh fruits' },
        }),
        this.prisma.category.create({
          data: { name: 'Vegetables', slug: 'vegetables', storeType: 'ORGANIC', description: 'Farm-fresh organic vegetables' },
        }),
        this.prisma.category.create({
          data: { name: 'Grains & Cereals', slug: 'grains', storeType: 'ORGANIC', description: 'Organic grains and cereals' },
        }),
        this.prisma.category.create({
          data: { name: 'Dairy & Eggs', slug: 'dairy', storeType: 'ORGANIC', description: 'Organic dairy products' },
        }),
      ]);

      const naturalCategories = await Promise.all([
        this.prisma.category.create({
          data: { name: 'Skincare', slug: 'skincare', storeType: 'NATURAL', description: 'Natural skincare products' },
        }),
        this.prisma.category.create({
          data: { name: 'Haircare', slug: 'haircare', storeType: 'NATURAL', description: 'Natural haircare solutions' },
        }),
        this.prisma.category.create({
          data: { name: 'Wellness', slug: 'wellness', storeType: 'NATURAL', description: 'Natural wellness products' },
        }),
        this.prisma.category.create({
          data: { name: 'Home & Living', slug: 'home-living', storeType: 'NATURAL', description: 'Natural home products' },
        }),
      ]);

      const ecoCategories = await Promise.all([
        this.prisma.category.create({
          data: { name: 'Kitchen', slug: 'kitchen', storeType: 'ECO_FRIENDLY', description: 'Eco-friendly kitchen essentials' },
        }),
        this.prisma.category.create({
          data: { name: 'Cleaning', slug: 'cleaning', storeType: 'ECO_FRIENDLY', description: 'Eco-friendly cleaning products' },
        }),
        this.prisma.category.create({
          data: { name: 'Accessories', slug: 'accessories', storeType: 'ECO_FRIENDLY', description: 'Sustainable accessories' },
        }),
        this.prisma.category.create({
          data: { name: 'Clothing', slug: 'clothing', storeType: 'ECO_FRIENDLY', description: 'Eco-friendly clothing' },
        }),
      ]);

      // 3. Create Vendors (storeName, storeSlug, zoneId required)
      this.logger.log('Creating vendors...');
      const vendors = await Promise.all([
        this.prisma.vendor.create({
          data: {
            userId: vendorUsers[0].id,
            storeName: 'Green Earth Organics',
            storeSlug: 'green-earth-organics',
            storeType: 'ORGANIC',
            zoneId: hyderabadZone.id,
            commissionPct: 15,
            status: 'APPROVED',
            description: 'Certified organic products from local farms',
          },
        }),
        this.prisma.vendor.create({
          data: {
            userId: vendorUsers[1].id,
            storeName: 'Pure Natural Living',
            storeSlug: 'pure-natural-living',
            storeType: 'NATURAL',
            zoneId: hyderabadZone.id,
            commissionPct: 15,
            status: 'APPROVED',
            description: 'Natural and Ayurvedic products for healthy living',
          },
        }),
        this.prisma.vendor.create({
          data: {
            userId: vendorUsers[2].id,
            storeName: 'Eco Harmony Store',
            storeSlug: 'eco-harmony-store',
            storeType: 'ECO_FRIENDLY',
            zoneId: hyderabadZone.id,
            commissionPct: 15,
            status: 'APPROVED',
            description: 'Sustainable and eco-friendly everyday products',
          },
        }),
      ]);

      // 4. Create Products
      this.logger.log('Creating products...');
      const organicProducts = [
        { name: 'Organic Apples (1kg)', slug: 'organic-apples', price: 250, description: 'Fresh organic apples from Himachal Pradesh', categoryId: organicCategories[0].id },
        { name: 'Organic Bananas (1 dozen)', slug: 'organic-bananas', price: 120, description: 'Sweet organic bananas', categoryId: organicCategories[0].id },
        { name: 'Spinach (500g)', slug: 'spinach', price: 60, description: 'Fresh organic spinach', categoryId: organicCategories[1].id },
        { name: 'Tomatoes (1kg)', slug: 'tomatoes', price: 80, description: 'Juicy organic tomatoes', categoryId: organicCategories[1].id },
        { name: 'Brown Rice (2kg)', slug: 'brown-rice', price: 180, description: 'Organic brown rice', categoryId: organicCategories[2].id },
        { name: 'Oats (1kg)', slug: 'oats', price: 150, description: 'Organic rolled oats', categoryId: organicCategories[2].id },
        { name: 'Organic Milk (1L)', slug: 'organic-milk', price: 85, description: 'Fresh organic milk', categoryId: organicCategories[3].id },
        { name: 'Free Range Eggs (12)', slug: 'eggs', price: 120, description: 'Free range organic eggs', categoryId: organicCategories[3].id },
      ];

      const naturalProducts = [
        { name: 'Aloe Vera Gel (200ml)', slug: 'aloe-vera-gel', price: 250, description: 'Pure aloe vera gel for skin', categoryId: naturalCategories[0].id },
        { name: 'Neem Face Wash (150ml)', slug: 'neem-face-wash', price: 180, description: 'Natural neem face wash', categoryId: naturalCategories[0].id },
        { name: 'Coconut Hair Oil (200ml)', slug: 'coconut-hair-oil', price: 220, description: 'Cold-pressed coconut oil for hair', categoryId: naturalCategories[1].id },
        { name: 'Shikakai Shampoo (250ml)', slug: 'shikakai-shampoo', price: 190, description: 'Natural shikakai shampoo', categoryId: naturalCategories[1].id },
        { name: 'Ashwagandha Capsules (60)', slug: 'ashwagandha', price: 350, description: 'Organic ashwagandha supplements', categoryId: naturalCategories[2].id },
        { name: 'Tulsi Drops (30ml)', slug: 'tulsi-drops', price: 120, description: 'Holy basil extract drops', categoryId: naturalCategories[2].id },
        { name: 'Camphor Tablets (100g)', slug: 'camphor', price: 80, description: 'Natural camphor for home', categoryId: naturalCategories[3].id },
        { name: 'Essential Oil Set (6 x 10ml)', slug: 'essential-oils', price: 550, description: 'Lavender, eucalyptus, tea tree oils', categoryId: naturalCategories[3].id },
      ];

      const ecoProducts = [
        { name: 'Steel Lunch Box', slug: 'steel-lunch-box', price: 450, description: 'Stainless steel reusable lunch box', categoryId: ecoCategories[0].id },
        { name: 'Bamboo Cutlery Set', slug: 'bamboo-cutlery', price: 350, description: 'Portable bamboo cutlery set', categoryId: ecoCategories[0].id },
        { name: 'Natural Dish Soap (500ml)', slug: 'dish-soap', price: 180, description: 'Eco-friendly dish soap', categoryId: ecoCategories[1].id },
        { name: 'Coconut Fiber Brush', slug: 'coconut-brush', price: 120, description: 'Natural coconut fiber cleaning brush', categoryId: ecoCategories[1].id },
        { name: 'Jute Tote Bag', slug: 'jute-bag', price: 250, description: 'Reusable jute shopping bag', categoryId: ecoCategories[2].id },
        { name: 'Bamboo Sunglasses', slug: 'bamboo-sunglasses', price: 800, description: 'Sustainable bamboo frame sunglasses', categoryId: ecoCategories[2].id },
        { name: 'Organic Cotton T-Shirt', slug: 'cotton-tshirt', price: 600, description: 'Eco-friendly cotton t-shirt', categoryId: ecoCategories[3].id },
        { name: 'Hemp Backpack', slug: 'hemp-backpack', price: 1200, description: 'Durable hemp fiber backpack', categoryId: ecoCategories[3].id },
      ];

      const createProducts = async (products: { name: string; slug?: string; price: number; description: string; categoryId: string }[], vendorId: string) => {
        return Promise.all(
          products.map(({ slug: _slug, ...p }) =>
            this.prisma.product.create({
              data: {
                ...p,
                vendorId,
                isApproved: true,
                isActive: true,
                stock: Math.floor(Math.random() * 50) + 10,
                unit: 'piece',
                images: [],
              },
            })
          )
        );
      };

      const allOrganicProducts = await createProducts(organicProducts, vendors[0].id);
      const allNaturalProducts = await createProducts(naturalProducts, vendors[1].id);
      const allEcoProducts = await createProducts(ecoProducts, vendors[2].id);

      // 5. Create Addresses (fullAddress, not street; no country)
      this.logger.log('Creating addresses...');
      const addresses = await Promise.all([
        this.prisma.address.create({
          data: {
            userId: customerUsers[0].id,
            label: 'Home',
            fullAddress: '123 MG Road, Banjara Hills',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001',
            isDefault: true,
          },
        }),
        this.prisma.address.create({
          data: {
            userId: customerUsers[1].id,
            label: 'Office',
            fullAddress: '456 Cyber Towers, HITEC City',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500034',
            isDefault: true,
          },
        }),
      ]);

      // 6. Create Orders (Order → OrderVendorGroup → OrderItem)
      this.logger.log('Creating orders...');
      const now = new Date();

      // Order 1: Rahul — DELIVERED — organic products
      const order1 = await this.prisma.order.create({
        data: {
          userId: customerUsers[0].id,
          addressId: addresses[0].id,
          orderNo: 'ORD-000001',
          totalAmount: 450,
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PAID',
          status: 'DELIVERED',
        },
      });

      const group1 = await this.prisma.orderVendorGroup.create({
        data: {
          orderId: order1.id,
          vendorId: vendors[0].id,
          subtotal: 450,
          status: 'DELIVERED',
        },
      });

      await this.prisma.orderItem.createMany({
        data: [
          { orderVendorGroupId: group1.id, productId: allOrganicProducts[0].id, name: allOrganicProducts[0].name, priceAtPurchase: allOrganicProducts[0].price, quantity: 1 },
          { orderVendorGroupId: group1.id, productId: allOrganicProducts[4].id, name: allOrganicProducts[4].name, priceAtPurchase: allOrganicProducts[4].price, quantity: 1 },
        ],
      });

      // Order 2: Priya — OUT_FOR_DELIVERY — natural products
      const order2 = await this.prisma.order.create({
        data: {
          userId: customerUsers[1].id,
          addressId: addresses[1].id,
          orderNo: 'ORD-000002',
          totalAmount: 850,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          status: 'OUT_FOR_DELIVERY',
        },
      });

      const group2 = await this.prisma.orderVendorGroup.create({
        data: {
          orderId: order2.id,
          vendorId: vendors[1].id,
          subtotal: 850,
          status: 'OUT_FOR_DELIVERY',
        },
      });

      await this.prisma.orderItem.createMany({
        data: [
          { orderVendorGroupId: group2.id, productId: allNaturalProducts[0].id, name: allNaturalProducts[0].name, priceAtPurchase: allNaturalProducts[0].price, quantity: 2 },
          { orderVendorGroupId: group2.id, productId: allNaturalProducts[4].id, name: allNaturalProducts[4].name, priceAtPurchase: allNaturalProducts[4].price, quantity: 1 },
        ],
      });

      // Order 3: Amit — CONFIRMED — eco products
      const order3 = await this.prisma.order.create({
        data: {
          userId: customerUsers[2].id,
          addressId: addresses[0].id,
          orderNo: 'ORD-000003',
          totalAmount: 450,
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
        },
      });

      const group3 = await this.prisma.orderVendorGroup.create({
        data: {
          orderId: order3.id,
          vendorId: vendors[2].id,
          subtotal: 450,
          status: 'CONFIRMED',
        },
      });

      await this.prisma.orderItem.createMany({
        data: [
          { orderVendorGroupId: group3.id, productId: allEcoProducts[0].id, name: allEcoProducts[0].name, priceAtPurchase: allEcoProducts[0].price, quantity: 1 },
        ],
      });

      // Order 4: Sneha — PLACED (not PENDING — that's not in OrderStatus enum)
      const order4 = await this.prisma.order.create({
        data: {
          userId: customerUsers[3].id,
          addressId: addresses[1].id,
          orderNo: 'ORD-000004',
          totalAmount: 205,
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PENDING',
          status: 'PLACED',
        },
      });

      const group4 = await this.prisma.orderVendorGroup.create({
        data: {
          orderId: order4.id,
          vendorId: vendors[0].id,
          subtotal: 205,
          status: 'PLACED',
        },
      });

      await this.prisma.orderItem.createMany({
        data: [
          { orderVendorGroupId: group4.id, productId: allOrganicProducts[2].id, name: allOrganicProducts[2].name, priceAtPurchase: allOrganicProducts[2].price, quantity: 2 },
          { orderVendorGroupId: group4.id, productId: allOrganicProducts[6].id, name: allOrganicProducts[6].name, priceAtPurchase: allOrganicProducts[6].price, quantity: 1 },
        ],
      });

      // Order 5: Rahul — DELIVERED — eco products
      const order5 = await this.prisma.order.create({
        data: {
          userId: customerUsers[0].id,
          addressId: addresses[0].id,
          orderNo: 'ORD-000005',
          totalAmount: 1450,
          paymentMethod: 'RAZORPAY',
          paymentStatus: 'PAID',
          status: 'DELIVERED',
        },
      });

      const group5 = await this.prisma.orderVendorGroup.create({
        data: {
          orderId: order5.id,
          vendorId: vendors[2].id,
          subtotal: 1450,
          status: 'DELIVERED',
        },
      });

      await this.prisma.orderItem.createMany({
        data: [
          { orderVendorGroupId: group5.id, productId: allEcoProducts[4].id, name: allEcoProducts[4].name, priceAtPurchase: allEcoProducts[4].price, quantity: 1 },
          { orderVendorGroupId: group5.id, productId: allEcoProducts[7].id, name: allEcoProducts[7].name, priceAtPurchase: allEcoProducts[7].price, quantity: 1 },
        ],
      });

      this.logger.log('Seed completed successfully!');
      return {
        message: 'Database seeded successfully',
        counts: {
          zones: 1,
          users: 10,
          vendors: 3,
          categories: 12,
          products: 24,
          orders: 5,
        },
      };
    } catch (error) {
      this.logger.error('Seed failed:', error);
      throw error;
    }
  }

  async reset() {
    this.logger.log('Resetting database...');

    // Delete in reverse order of dependencies
    await this.prisma.orderItem.deleteMany();
    await this.prisma.deliveryAssignment.deleteMany();
    await this.prisma.orderVendorGroup.deleteMany();
    await this.prisma.order.deleteMany();
    await this.prisma.payment.deleteMany();
    await this.prisma.commission.deleteMany();
    await this.prisma.cartItem.deleteMany();
    await this.prisma.wishlistItem.deleteMany();
    await this.prisma.review.deleteMany();
    await this.prisma.product.deleteMany();
    await this.prisma.category.deleteMany();
    await this.prisma.vendor.deleteMany();
    await this.prisma.pushToken.deleteMany();
    await this.prisma.aI_Log.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.address.deleteMany();
    await this.prisma.zone.deleteMany();
    await this.prisma.user.deleteMany();

    this.logger.log('Database reset complete');
    return { message: 'Database reset successfully' };
  }

  async getStatus() {
    const counts = {
      users: await this.prisma.user.count(),
      vendors: await this.prisma.vendor.count(),
      categories: await this.prisma.category.count(),
      products: await this.prisma.product.count(),
      orders: await this.prisma.order.count(),
    };

    return {
      seeded: counts.users > 0,
      counts,
    };
  }
}
