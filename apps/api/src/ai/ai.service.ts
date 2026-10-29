import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ScanResult {
  productName: string;
  category: string;
  nutritionalInfo?: Record<string, any>;
  confidence: number;
  matchedProductId?: string;
}

export interface Recommendation {
  productId: string;
  productName: string;
  reason: string;
  score: number;
}

export interface HealthInsight {
  summary: string;
  tips: string[];
  warnings: string[];
  suggestedProducts: string[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openaiApiKey: string;
  private geminiApiKey: string;

  constructor(private prisma: PrismaService) {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
  }

  /**
   * Chat with AI assistant about products, orders, and health tips
   */
  async chat(userId: string, message: string, context?: { productId?: string; orderId?: string }): Promise<{ response: string; conversationId: string }> {
    this.logger.log(`AI chat request from user ${userId}: ${message.substring(0, 50)}...`);

    // Build system prompt with marketplace context
    const systemPrompt = this.buildSystemPrompt(context);

    // Get recent chat history for context
    const recentHistory = await this.getRecentChatHistory(userId, 10);

    // Prepare messages for OpenAI/Gemini
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ];

    // Call AI API (OpenAI or Gemini)
    let aiResponse: string;
    if (this.openaiApiKey) {
      aiResponse = await this.callOpenAI(messages);
    } else if (this.geminiApiKey) {
      aiResponse = await this.callGemini(messages);
    } else {
      // Fallback to mock response if no API key configured
      aiResponse = this.generateMockResponse(message);
    }

    // Log interaction
    const conversationId = await this.logInteraction(userId, 'CHAT', message, aiResponse);

    return { response: aiResponse, conversationId };
  }

  /**
   * Scan a product using camera image
   */
  async scanProduct(userId: string, imageBuffer: Buffer): Promise<ScanResult> {
    this.logger.log(`AI scan request from user ${userId}`);

    // Call vision API to identify product
    let scanResult: ScanResult;
    if (this.openaiApiKey) {
      scanResult = await this.callOpenAIVision(imageBuffer);
    } else if (this.geminiApiKey) {
      scanResult = await this.callGeminiVision(imageBuffer);
    } else {
      // Mock scan result
      scanResult = {
        productName: 'Organic Product',
        category: 'ORGANIC',
        nutritionalInfo: { calories: 100, protein: 5, carbs: 15, fat: 3 },
        confidence: 0.85,
      };
    }

    // Try to match with database product
    const matchedProduct = await this.findMatchingProduct(scanResult.productName);
    if (matchedProduct) {
      scanResult.matchedProductId = matchedProduct.id;
    }

    // Log interaction
    await this.logInteraction(userId, 'SCANNER', `Scanned image`, JSON.stringify(scanResult));

    return scanResult;
  }

  /**
   * Get personalized product recommendations
   */
  async getRecommendations(userId: string, limit: number = 10): Promise<Recommendation[]> {
    this.logger.log(`AI recommendations request for user ${userId}`);

    // Get user's order history and wishlist
    const [orders, wishlist] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        include: {
          vendorGroups: {
            include: {
              items: { include: { product: { include: { category: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.wishlistItem.findMany({
        where: { userId },
        include: { product: true },
        take: 20,
      }),
    ]);

    // Extract frequently bought categories
    const categoryFrequency = new Map<string, number>();
    orders.forEach(order => {
      order.vendorGroups.forEach(group => {
        group.items.forEach(item => {
          const categoryName = item.product?.category?.name;
          if (categoryName) {
            categoryFrequency.set(categoryName, (categoryFrequency.get(categoryName) || 0) + item.quantity);
          }
        });
      });
    });

    // Get products from preferred categories
    const preferredCategories = Array.from(categoryFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category]) => category);

    // Find products to recommend
    const recommendations: Recommendation[] = [];
    
    // Look up category IDs from names
    const preferredCategoryRecords = await this.prisma.category.findMany({
      where: { name: { in: preferredCategories } },
      select: { id: true, name: true },
    });
    const preferredCategoryIds = preferredCategoryRecords.map(c => c.id);
    
    // Get products from preferred categories
    const categoryProducts = await this.prisma.product.findMany({
      where: {
        categoryId: { in: preferredCategoryIds },
        isApproved: true,
        isActive: true,
      },
      include: { category: true },
      take: limit,
    });

    categoryProducts.forEach(product => {
      recommendations.push({
        productId: product.id,
        productName: product.name,
        reason: `Based on your interest in ${product.category?.name || 'similar products'}`,
        score: 0.8 + Math.random() * 0.2,
      });
    });

    // Add trending products if we need more
    if (recommendations.length < limit) {
      const trendingProducts = await this.prisma.product.findMany({
        where: {
          isApproved: true,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit - recommendations.length,
      });

      trendingProducts.forEach(product => {
        recommendations.push({
          productId: product.id,
          productName: product.name,
          reason: 'Trending now',
          score: 0.6 + Math.random() * 0.3,
        });
      });
    }

    // Sort by score and limit
    const sortedRecommendations = recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Log interaction
    await this.logInteraction(userId, 'RECOMMENDATION', `Requested ${limit} recommendations`, JSON.stringify(sortedRecommendations));

    return sortedRecommendations;
  }

  /**
   * Get health insights based on purchased products
   */
  async getHealthInsights(userId: string): Promise<HealthInsight> {
    this.logger.log(`AI health insights request for user ${userId}`);

    // Get user's recent purchases
    const orders = await this.prisma.order.findMany({
      where: { userId, status: 'DELIVERED' },
      include: {
        vendorGroups: {
          include: {
            items: { include: { product: { include: { category: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    // Analyze purchased products
    const purchasedProducts = orders.flatMap(order =>
      order.vendorGroups.flatMap(group =>
        group.items.map(item => item.product).filter(Boolean)
      )
    );

    // Categorize purchases
    const categories = new Map<string, number>();
    purchasedProducts.forEach(product => {
      const categoryName = product?.category?.name;
      if (categoryName) {
        categories.set(categoryName, (categories.get(categoryName) || 0) + 1);
      }
    });

    // Generate insights
    const tips: string[] = [];
    const warnings: string[] = [];
    const suggestedProducts: string[] = [];

    // Analyze category distribution
    const totalProducts = purchasedProducts.length;
    const organicCount = categories.get('ORGANIC') || 0;
    const naturalCount = categories.get('NATURAL') || 0;
    const ecoCount = categories.get('ECO_FRIENDLY') || 0;

    if (organicCount / totalProducts > 0.5) {
      tips.push('Great job! You\'re consuming mostly organic products.');
    } else {
      tips.push('Consider adding more organic products to your diet.');
    }

    if (naturalCount < 3) {
      tips.push('Try exploring natural products for a more balanced lifestyle.');
    }

    if (ecoCount < 2) {
      tips.push('Eco-friendly products help reduce your environmental footprint.');
    }

    // Check for vegetable purchases
    const vegetablePurchases = purchasedProducts.filter(p => 
      p?.name?.toLowerCase().includes('vegetable') || 
      p?.name?.toLowerCase().includes('green')
    ).length;

    if (vegetablePurchases < 5) {
      warnings.push('You haven\'t purchased many vegetables recently. Consider adding more greens to your diet.');
    }

    // Generate summary
    const summary = `Based on your ${totalProducts} purchases, you prefer ${this.getMostFrequentCategory(categories)} products. ` +
      `Your shopping pattern shows a focus on ${this.getShoppingPattern(categories)}.`;

    // Log interaction
    await this.logInteraction(userId, 'HEALTH_INSIGHT', 'Requested health insights', JSON.stringify({ summary, tips, warnings }));

    return { summary, tips, warnings, suggestedProducts };
  }

  /**
   * Get chat history for a user
   */
  async getChatHistory(userId: string, page: number = 1, limit: number = 20): Promise<{ messages: any[]; total: number; page: number; totalPages: number }> {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.aI_Log.findMany({
        where: { userId, type: 'CHAT' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.aI_Log.count({
        where: { userId, type: 'CHAT' },
      }),
    ]);

    return {
      messages,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get admin AI logs
   */
  async getAdminLogs(filters: {
    type?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number; page: number; totalPages: number }> {
    const { type, userId, startDate, endDate, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.aI_Log.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.aI_Log.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get admin AI analytics
   */
  async getAdminAnalytics(dateRange?: { start: string; end: string }): Promise<any> {
    const where: any = {};
    if (dateRange) {
      where.createdAt = {};
      if (dateRange.start) where.createdAt.gte = new Date(dateRange.start);
      if (dateRange.end) where.createdAt.lte = new Date(dateRange.end);
    }

    const [totalInteractions, interactionsByType, recentInteractions] = await Promise.all([
      this.prisma.aI_Log.count({ where }),
      this.prisma.aI_Log.groupBy({
        by: ['type'],
        where,
        _count: { type: true },
      }),
      this.prisma.aI_Log.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    // Calculate popular queries
    const queryFrequency = new Map<string, number>();
    recentInteractions.forEach(interaction => {
      const query = interaction.input?.substring(0, 50) || 'unknown';
      queryFrequency.set(query, (queryFrequency.get(query) || 0) + 1);
    });

    const popularQueries = Array.from(queryFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    return {
      totalInteractions,
      interactionsByType: interactionsByType.map(item => ({
        type: item.type,
        count: item._count.type,
      })),
      popularQueries,
    };
  }

  // Private helper methods

  private buildSystemPrompt(context?: { productId?: string; orderId?: string }): string {
    let prompt = `You are a helpful AI assistant for Next360, an organic/natural/eco-friendly marketplace. 
You can help customers with:
- Product recommendations and information
- Health tips and dietary advice
- Order tracking and support
- General shopping assistance

You have access to our product catalog which includes:
- Organic products (fresh produce, grains, dairy)
- Natural products (herbal, wellness, personal care)
- Eco-friendly products (sustainable, zero-waste)

Always be helpful, friendly, and knowledgeable about organic/natural products.
Keep responses concise and actionable.`;

    if (context?.productId) {
      prompt += `\n\nThe user is currently viewing a product (ID: ${context.productId}). Provide context-aware assistance.`;
    }
    if (context?.orderId) {
      prompt += `\n\nThe user is asking about order ${context.orderId}. Help with order-related queries.`;
    }

    return prompt;
  }

  private async getRecentChatHistory(userId: string, limit: number): Promise<{ role: string; content: string }[]> {
    const logs = await this.prisma.aI_Log.findMany({
      where: { userId, type: 'CHAT' },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // Get both user and assistant messages
    });

    // Convert logs to chat history format
    const history: { role: string; content: string }[] = [];
    logs.reverse().forEach(log => {
      if (log.input) history.push({ role: 'user', content: log.input });
      if (log.output) history.push({ role: 'assistant', content: log.output });
    });

    return history.slice(-limit * 2);
  }

  private async callOpenAI(messages: ChatMessage[]): Promise<string> {
    // OpenAI API integration
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || 'Sorry, I could not process your request.';
  }

  private async callGemini(messages: ChatMessage[]): Promise<string> {
    // Gemini API integration
    const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userMessage }] }],
      }),
    });

    const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process your request.';
  }

  private async callOpenAIVision(imageBuffer: Buffer): Promise<ScanResult> {
    // OpenAI Vision API for product scanning
    const base64Image = imageBuffer.toString('base64');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this product image and provide: 1) Product name, 2) Category (ORGANIC/NATURAL/ECO_FRIENDLY), 3) Nutritional information if available, 4) Confidence score (0-1). Return as JSON.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content || '{}';
    
    try {
      const parsed = JSON.parse(content);
      return {
        productName: parsed.productName || 'Unknown Product',
        category: parsed.category || 'ORGANIC',
        nutritionalInfo: parsed.nutritionalInfo,
        confidence: parsed.confidence || 0.5,
      };
    } catch {
      return {
        productName: 'Unknown Product',
        category: 'ORGANIC',
        confidence: 0.3,
      };
    }
  }

  private async callGeminiVision(imageBuffer: Buffer): Promise<ScanResult> {
    // Gemini Vision API for product scanning
    const base64Image = imageBuffer.toString('base64');
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Analyze this product image and provide: 1) Product name, 2) Category (ORGANIC/NATURAL/ECO_FRIENDLY), 3) Nutritional information if available, 4) Confidence score (0-1). Return as JSON.' },
            { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          ],
        }],
      }),
    });

    const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    try {
      const parsed = JSON.parse(content);
      return {
        productName: parsed.productName || 'Unknown Product',
        category: parsed.category || 'ORGANIC',
        nutritionalInfo: parsed.nutritionalInfo,
        confidence: parsed.confidence || 0.5,
      };
    } catch {
      return {
        productName: 'Unknown Product',
        category: 'ORGANIC',
        confidence: 0.3,
      };
    }
  }

  private generateMockResponse(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('recommend') || lowerMessage.includes('suggest')) {
      return 'Based on your preferences, I recommend trying our organic fresh vegetables bundle. It includes seasonal greens, root vegetables, and herbs - all 100% organic and sourced directly from local farms.';
    }
    if (lowerMessage.includes('health') || lowerMessage.includes('diet')) {
      return 'For a healthy diet, I suggest incorporating more leafy greens and whole grains. Our organic spinach and brown rice are popular choices. Would you like me to show you some options?';
    }
    if (lowerMessage.includes('track') || lowerMessage.includes('order')) {
      return 'I can help you track your order. Could you please provide your order ID? You can find it in your order history or in the confirmation email.';
    }
    
    return 'I\'m your Next360 AI assistant! I can help you with product recommendations, health tips, order tracking, and more. What would you like to know?';
  }

  private async findMatchingProduct(productName: string): Promise<{ id: string } | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        name: { contains: productName, mode: 'insensitive' },
        isApproved: true,
      },
      select: { id: true },
    });
    return product;
  }

  private async logInteraction(userId: string, type: string, input: string, output: string): Promise<string> {
    const log = await this.prisma.aI_Log.create({
      data: {
        userId,
        type,
        input,
        output,
      },
    });
    return log.id;
  }

  private getMostFrequentCategory(categories: Map<string, number>): string {
    let maxCount = 0;
    let mostFrequent = 'organic';
    categories.forEach((count, category) => {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = category.toLowerCase();
      }
    });
    return mostFrequent;
  }

  private getShoppingPattern(categories: Map<string, number>): string {
    const total = Array.from(categories.values()).reduce((sum, count) => sum + count, 0);
    const percentages = Array.from(categories.entries()).map(([category, count]) => ({
      category,
      percentage: (count / total) * 100,
    }));

    if (percentages.some(p => p.percentage > 60)) {
      return 'focused shopping';
    }
    return 'diverse shopping';
  }
}
