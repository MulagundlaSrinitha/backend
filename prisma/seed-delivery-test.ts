import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const IDS = {
  zone: "7c4e8b21-5f3a-4d72-9c16-82b7e4a1d305",

  customer: "1f8a63d4-92b5-4c71-a8e3-56d2049f731a",
  customer2: "6b2d914e-3a87-4f65-b1c9-742e5086d3fa",

  vendorUser: "9e41c7a2-6d58-4b93-8f24-3157a0c96de8",
  vendor: "2a73f9c1-84de-4b56-97a2-6e31c508d4bf",

  partnerUser1: "5d19e7b3-c246-4a81-9f35-7082c6e4a1db",
  partner1: "8f52c1d6-37a4-4e90-b825-6419d7a3c6ef",

  partnerUser2: "3b76a9e4-15c2-48d7-8f61-9205e4b3ca78",
  partner2: "c4a18e62-79d3-45bf-a906-53e7c2814d9a",

  category: "a62d4f91-8b37-4c05-9e72-16a5d8c3f047",
  product: "e3157a84-62c9-4f31-b8d6-9042ce71a5fb",

  address1: "4b83d2f7-19e6-46a5-9c31-7580e4d2ab96",
  address2: "d7614e29-53b8-4a06-91cf-2875b3e9c640",

  orderClaim: "91d4e7b2-6f38-4c59-a815-2039e6a74dcb",
  orderReject: "36b8c5e1-74a2-4d90-9f63-5817e2a4bc09",
  orderCompleted1: "c52f9a73-18d6-4b04-87e1-6392a5d4fc80",
  orderCompleted2: "7a31e8c4-95f2-46bd-a607-2149d3f85ce2",

  groupClaim: "e84c2a61-37f5-4d90-b812-6591f3a7ce24",
  groupReject: "5f92d7b4-61a8-4ce3-9035-2786b1e4ac79",
  groupCompleted1: "a17e4c93-82d5-4b61-9f08-5362d7a1e4bc",
  groupCompleted2: "d43a8f25-69c1-47e0-b532-8147e6c9a0fd",

  itemClaim: "6e21b7d4-93a5-4c80-8f16-5273a9e4d2bc",
  itemReject: "b95d3e71-46c8-4a02-917f-6382e5c4ab19",
  itemCompleted1: "2c74f8a1-59d6-43be-a805-9716e3d2c4fa",
  itemCompleted2: "f61a3c82-75e9-4d10-b647-2395e8a1c406",

  assignment1: "84b2e7c5-31a9-46d8-905f-6723a1e4bc98",
  assignment2: "19f6c3a7-52d8-4e01-b945-7632e8a4dc10",

  payout1: "a83d5f21-64c9-4b70-9e18-2756c3a4f0db",
  payout2: "c71e9a43-85d2-46b0-a539-6147f2d8ce05",
};

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function main() {
  console.log("Starting Delivery Partner test seed...");
  console.log("Target database should be next360_test.");

  // ------------------------------------------------------------
  // 1. ZONE
  // ------------------------------------------------------------

  const zone = await prisma.zone.upsert({
    where: { id: IDS.zone },
    update: {
      name: "Central Hyderabad Zone",
      city: "Hyderabad",
      pincodes: ["500034", "500081", "500082"],
      isActive: true,
    },
    create: {
      id: IDS.zone,
      name: "Central Hyderabad Zone",
      city: "Hyderabad",
      pincodes: ["500034", "500081", "500082"],
      isActive: true,
    },
  });

  // ------------------------------------------------------------
  // 2. CUSTOMER USERS
  // ------------------------------------------------------------

  const customer = await prisma.user.upsert({
    where: { id: IDS.customer },
    update: {
      email: "meghana.rao@next360.local",
      name: "Meghana Rao",
      role: "CUSTOMER",
      isActive: true,
    },
    create: {
      id: IDS.customer,
      email: "meghana.rao@next360.local",
      name: "Meghana Rao",
      phone: "9876543210",
      role: "CUSTOMER",
      isActive: true,
    },
  });

  const customer2 = await prisma.user.upsert({
    where: { id: IDS.customer2 },
    update: {
      email: "rohit.varma@next360.local",
      name: "Rohit Varma",
      role: "CUSTOMER",
      isActive: true,
    },
    create: {
      id: IDS.customer2,
      email: "rohit.varma@next360.local",
      name: "Rohit Varma",
      phone: "9867452310",
      role: "CUSTOMER",
      isActive: true,
    },
  });

  // ------------------------------------------------------------
  // 3. VENDOR USER + VENDOR
  // ------------------------------------------------------------

  const vendorUser = await prisma.user.upsert({
    where: { id: IDS.vendorUser },
    update: {
      email: "greenleaf.vendor@next360.local",
      name: "Vivek Sharma",
      role: "VENDOR",
      isActive: true,
    },
    create: {
      id: IDS.vendorUser,
      email: "greenleaf.vendor@next360.local",
      name: "Vivek Sharma",
      phone: "9856321470",
      role: "VENDOR",
      isActive: true,
    },
  });

  const vendor = await prisma.vendor.upsert({
    where: { id: IDS.vendor },
    update: {
      storeName: "GreenLeaf Organics",
      storeSlug: "greenleaf-organics-test",
      storeType: "ORGANIC",
      sellerType: "BUSINESS",
      status: "APPROVED",
      zoneId: zone.id,
      commissionPct: 10,
    },
    create: {
      id: IDS.vendor,
      userId: vendorUser.id,
      storeName: "GreenLeaf Organics",
      storeSlug: "greenleaf-organics-test",
      storeType: "ORGANIC",
      sellerType: "BUSINESS",
      description: "Organic grocery test vendor",
      ownerName: "Vivek Sharma",
      address: "Banjara Hills, Hyderabad",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500072",
      status: "APPROVED",
      commissionPct: 10,
      zoneId: zone.id,
    },
  });

  // ------------------------------------------------------------
  // 4. DELIVERY PARTNER USERS
  // ------------------------------------------------------------

  const partnerUser1 = await prisma.user.upsert({
    where: { id: IDS.partnerUser1 },
    update: {
      email: "arjun.delivery@next360.local",
      name: "Arjun Nair",
      role: "DELIVERY_PARTNER",
      isActive: true,
    },
    create: {
      id: IDS.partnerUser1,
      email: "arjun.delivery@next360.local",
      name: "Arjun Nair",
      phone: "9848012345",
      role: "DELIVERY_PARTNER",
      isActive: true,
    },
  });

  const partnerUser2 = await prisma.user.upsert({
    where: { id: IDS.partnerUser2 },
    update: {
      email: "kiran.delivery@next360.local",
      name: "Kiran Shetty",
      role: "DELIVERY_PARTNER",
      isActive: true,
    },
    create: {
      id: IDS.partnerUser2,
      email: "kiran.delivery@next360.local",
      name: "Kiran Shetty",
      phone: "9829012345",
      role: "DELIVERY_PARTNER",
      isActive: true,
    },
  });

  const partner1 = await prisma.deliveryPartner.upsert({
    where: { id: IDS.partner1 },
    update: {
      userId: partnerUser1.id,
      vehicleType: "BIKE",
      zoneId: zone.id,
      status: "AVAILABLE",
      currentLat: 17.4239,
      currentLng: 78.4738,
    },
    create: {
      id: IDS.partner1,
      userId: partnerUser1.id,
      vehicleType: "BIKE",
      zoneId: zone.id,
      status: "AVAILABLE",
      currentLat: 17.4239,
      currentLng: 78.4738,
    },
  });

  const partner2 = await prisma.deliveryPartner.upsert({
    where: { id: IDS.partner2 },
    update: {
      userId: partnerUser2.id,
      vehicleType: "SCOOTER",
      zoneId: zone.id,
      status: "AVAILABLE",
      currentLat: 17.4399,
      currentLng: 78.4983,
    },
    create: {
      id: IDS.partner2,
      userId: partnerUser2.id,
      vehicleType: "SCOOTER",
      zoneId: zone.id,
      status: "AVAILABLE",
      currentLat: 17.4399,
      currentLng: 78.4983,
    },
  });

  // ------------------------------------------------------------
  // 5. CATEGORY
  // ------------------------------------------------------------

  const category = await prisma.category.upsert({
    where: { id: IDS.category },
    update: {
      name: "Organic Staples",
      slug: "organic-staples",
      storeType: "ORGANIC",
      isActive: true,
    },
    create: {
      id: IDS.category,
      name: "Organic Staples",
      slug: "organic-staples",
      description: "Organic grocery category",
      storeType: "ORGANIC",
      isActive: true,
    },
  });

  // ------------------------------------------------------------
  // 6. PRODUCT
  // ------------------------------------------------------------

  const product = await prisma.product.upsert({
    where: { id: IDS.product },
    update: {
      name: "Organic Brown Rice",
      price: 560,
      unit: "kg",
      stock: 75,
      isActive: true,
      isApproved: true,
    },
    create: {
      id: IDS.product,
      vendorId: vendor.id,
      categoryId: category.id,
      name: "Organic Brown Rice",
      description: "Premium organic brown rice for delivery API testing",
      price: 560,
      unit: "kg",
      stock: 75,
      images: [],
      isActive: true,
      isApproved: true,
    },
  });

  // ------------------------------------------------------------
  // 7. CUSTOMER ADDRESSES
  // ------------------------------------------------------------

  const address1 = await prisma.address.upsert({
    where: { id: IDS.address1 },
    update: {
      fullAddress: "H.No. 6-2-18, Subedari, Warangal, Telangana",
      city: "Warangal",
      state: "Telangana",
      pincode: "506001",
      lat: 17.9784,
      lng: 79.5941,
      isDefault: true,
    },
    create: {
      id: IDS.address1,
      userId: customer.id,
      label: "Home",
      fullAddress: "H.No. 6-2-18, Subedari, Warangal, Telangana",
      city: "Warangal",
      state: "Telangana",
      pincode: "506001",
      lat: 17.9784,
      lng: 79.5941,
      isDefault: true,
    },
  });

  const address2 = await prisma.address.upsert({
    where: { id: IDS.address2 },
    update: {
      fullAddress: "H.No. 3-5-42, Kothirampur, Hyderabad, Telangana",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "505001",
      lat: 18.4386,
      lng: 79.1288,
      isDefault: true,
    },
    create: {
      id: IDS.address2,
      userId: customer2.id,
      label: "Home",
      fullAddress: "H.No. 3-5-42, Kothirampur, Hyderabad, Telangana",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "505001",
      lat: 18.4386,
      lng: 79.1288,
      isDefault: true,
    },
  });

  // ------------------------------------------------------------
  // Helper to create/update an order + group + item
  // ------------------------------------------------------------

  async function createTestOrder(
    orderId: string,
    groupId: string,
    itemId: string,
    orderNo: string,
    userId: string,
    addressId: string,
    subtotal: number,
    status: "PACKED" | "DELIVERED",
    createdAt: Date,
  ) {
    const order = await prisma.order.upsert({
      where: { id: orderId },
      update: {
        orderNo,
        userId,
        addressId,
        totalAmount: subtotal,
        paymentMethod: "COD",
        paymentStatus: "PAID",
        status,
        createdAt,
      },
      create: {
        id: orderId,
        orderNo,
        userId,
        addressId,
        totalAmount: subtotal,
        paymentMethod: "COD",
        paymentStatus: "PAID",
        status,
        createdAt,
      },
    });

    const group = await prisma.orderVendorGroup.upsert({
      where: { id: groupId },
      update: {
        orderId: order.id,
        vendorId: vendor.id,
        subtotal,
        status,
      },
      create: {
        id: groupId,
        orderId: order.id,
        vendorId: vendor.id,
        subtotal,
        status,
      },
    });

    await prisma.orderItem.upsert({
      where: { id: itemId },
      update: {
        orderVendorGroupId: group.id,
        productId: product.id,
        name: product.name,
        priceAtPurchase: subtotal,
        quantity: 1,
      },
      create: {
        id: itemId,
        orderVendorGroupId: group.id,
        productId: product.id,
        name: product.name,
        priceAtPurchase: subtotal,
        quantity: 1,
      },
    });

    return { order, group };
  }

  // ------------------------------------------------------------
  // 8. CLAIMABLE ORDER
  // ------------------------------------------------------------

  await createTestOrder(
    IDS.orderClaim,
    IDS.groupClaim,
    IDS.itemClaim,
    "NXT360-ORD-1047",
    customer.id,
    address1.id,
    560,
    "PACKED",
    new Date(),
  );

  // ------------------------------------------------------------
  // 9. REJECTABLE ORDER
  // ------------------------------------------------------------

  await createTestOrder(
    IDS.orderReject,
    IDS.groupReject,
    IDS.itemReject,
    "NXT360-ORD-2183",
    customer.id,
    address1.id,
    735,
    "PACKED",
    new Date(),
  );

  // ------------------------------------------------------------
  // 10. COMPLETED DELIVERY FOR PARTNER 1
  //     Today -> earnings / transactions
  // ------------------------------------------------------------

  const completed1 = await createTestOrder(
    IDS.orderCompleted1,
    IDS.groupCompleted1,
    IDS.itemCompleted1,
    "NXT360-ORD-3269",
    customer.id,
    address1.id,
    680,
    "DELIVERED",
    new Date(),
  );

  await prisma.deliveryAssignment.upsert({
    where: { id: IDS.assignment1 },
    update: {
      orderVendorGroupId: completed1.group.id,
      deliveryPartnerId: partner1.id,
      otp: "481729",
      assignedAt: new Date(),
      pickedUpAt: new Date(),
      deliveredAt: new Date(),
    },
    create: {
      id: IDS.assignment1,
      orderVendorGroupId: completed1.group.id,
      deliveryPartnerId: partner1.id,
      otp: "481729",
      assignedAt: new Date(),
      pickedUpAt: new Date(),
      deliveredAt: new Date(),
    },
  });

  // ------------------------------------------------------------
  // 11. COMPLETED DELIVERY FOR PARTNER 2
  //     Older date -> cross-partner transaction/security test
  // ------------------------------------------------------------

  const completed2Date = daysAgo(10);

  const completed2 = await createTestOrder(
    IDS.orderCompleted2,
    IDS.groupCompleted2,
    IDS.itemCompleted2,
    "NXT360-ORD-4512",
    customer2.id,
    address2.id,
    920,
    "DELIVERED",
    completed2Date,
  );

  await prisma.deliveryAssignment.upsert({
    where: { id: IDS.assignment2 },
    update: {
      orderVendorGroupId: completed2.group.id,
      deliveryPartnerId: partner2.id,
      otp: "735204",
      assignedAt: completed2Date,
      pickedUpAt: completed2Date,
      deliveredAt: completed2Date,
    },
    create: {
      id: IDS.assignment2,
      orderVendorGroupId: completed2.group.id,
      deliveryPartnerId: partner2.id,
      otp: "735204",
      assignedAt: completed2Date,
      pickedUpAt: completed2Date,
      deliveredAt: completed2Date,
    },
  });

  // ------------------------------------------------------------
  // 12. PAYOUT FOR PARTNER 1
  // ------------------------------------------------------------

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  await prisma.payout.upsert({
    where: { id: IDS.payout1 },
    update: {
      deliveryPartnerId: partner1.id,
      orderId: completed1.order.id,
      vendorId: vendor.id,
      amount: 720,
      status: "PAID",
      periodStart: weekStart,
      periodEnd: now,
      paidAt: now,
    },
    create: {
      id: IDS.payout1,
      deliveryPartnerId: partner1.id,
      orderId: completed1.order.id,
      vendorId: vendor.id,
      amount: 720,
      status: "PAID",
      periodStart: weekStart,
      periodEnd: now,
      paidAt: now,
    },
  });

  // ------------------------------------------------------------
  // 13. PAYOUT FOR PARTNER 2
  // ------------------------------------------------------------

  const previousPeriodStart = daysAgo(14);
  const previousPeriodEnd = daysAgo(7);

  await prisma.payout.upsert({
    where: { id: IDS.payout2 },
    update: {
      deliveryPartnerId: partner2.id,
      orderId: completed2.order.id,
      vendorId: vendor.id,
      amount: 845,
      status: "PROCESSED",
      periodStart: previousPeriodStart,
      periodEnd: previousPeriodEnd,
    },
    create: {
      id: IDS.payout2,
      deliveryPartnerId: partner2.id,
      orderId: completed2.order.id,
      vendorId: vendor.id,
      amount: 845,
      status: "PROCESSED",
      periodStart: previousPeriodStart,
      periodEnd: previousPeriodEnd,
    },
  });

  console.log("");
  console.log("==============================================");
  console.log("DELIVERY TEST DATA CREATED");
  console.log("==============================================");
  console.log("");
  console.log("Delivery Partner 1:");
  console.log("  Email: delivery.test1@next360.local");
  console.log(`  User ID: ${partnerUser1.id}`);
  console.log(`  Partner ID: ${partner1.id}`);
  console.log("");
  console.log("Delivery Partner 2:");
  console.log("  Email: delivery.test2@next360.local");
  console.log(`  User ID: ${partnerUser2.id}`);
  console.log(`  Partner ID: ${partner2.id}`);
  console.log("");
  console.log("Claimable group:");
  console.log(`  ${IDS.groupClaim}`);
  console.log("");
  console.log("Rejectable group:");
  console.log(`  ${IDS.groupReject}`);
  console.log("");
  console.log("Completed Partner 1 assignment:");
  console.log(`  ${IDS.assignment1}`);
  console.log("");
  console.log("Completed Partner 2 assignment:");
  console.log(`  ${IDS.assignment2}`);
  console.log("");
  console.log("OTP Partner 1:");
  console.log("  123456");
  console.log("");
  console.log("OTP Partner 2:");
  console.log("  654321");
  console.log("");
  console.log("==============================================");
}

main()
  .catch((error) => {
    console.error("SEED FAILED");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });