import { Injectable, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private supabase: SupabaseClient | null = null;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  /**
   * Sniff the real file type from magic bytes. Client-supplied mimetype and
   * extension are both attacker-controlled and must never be trusted alone.
   */
  private sniffImageType(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
    if (buffer.length < 12) return null;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e &&
      buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a &&
      buffer[6] === 0x1a && buffer[7] === 0x0a
    ) return 'png';
    // GIF: "GIF87a" / "GIF89a"
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
    // WebP: "RIFF"...."WEBP"
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'webp';
    return null;
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'products',
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type: allowlist on the claimed mimetype AND verification
    // against magic bytes. A renamed .svg/.html/.exe must be rejected even
    // when it claims to be image/png.
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: ${allowedMimes.join(', ')}`,
      );
    }

    const sniffed = this.sniffImageType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        'File content does not match a supported image format (jpeg/png/webp/gif)',
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    // Filename is derived from the verified type, never the client extension.
    const fileName = `${folder}/${uuidv4()}.${sniffed}`;

    // Upload to Supabase Storage if configured
    if (this.supabase) {
      const { data, error } = await this.supabase.storage
        .from('products')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        throw new BadRequestException(`Upload failed: ${error.message}`);
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from('products')
        .getPublicUrl(fileName);

      return { url: urlData.publicUrl };
    }

    // Storage unconfigured: fail loudly in production instead of handing
    // back a fake placeholder URL. Dev keeps the placeholder for offline work.
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'Image storage is not configured. Try again later.',
      );
    }
    return { url: `https://via.placeholder.com/400?text=${encodeURIComponent('dev-placeholder')}` };
  }

  async uploadMultiple(
    files: Express.Multer.File[],
    folder: string = 'products',
  ): Promise<{ urls: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const results = await Promise.all(
      files.map((file) => this.uploadImage(file, folder)),
    );

    return { urls: results.map((r) => r.url) };
  }

  /**
   * Sniff a file's real type from magic bytes, extending sniffImageType with
   * PDF support — vendor KYC documents (bank statements, GST certificates)
   * are commonly submitted as PDFs, not just photos.
   */
  private sniffDocumentType(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | 'pdf' | null {
    if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
    return this.sniffImageType(buffer);
  }

  /**
   * Uploads a vendor KYC document (PAN, Aadhaar, GST certificate, bank proof,
   * etc.) to a private bucket. Unlike product/vendor images, these are never
   * given a public URL — callers must go through getSignedDocumentUrl(),
   * which issues a short-lived link, since these files contain sensitive PII.
   */
  async uploadVendorKycDocument(
    file: Express.Multer.File,
    vendorId: string,
  ): Promise<{ storageKey: string; fileName: string; mimeType: string; fileSize: number }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: jpeg, png, webp, pdf`,
      );
    }

    const sniffed = this.sniffDocumentType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        'File content does not match a supported format (jpeg/png/webp/pdf)',
      );
    }

    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File too large. Maximum size is 8MB');
    }

    const storageKey = `${vendorId}/${uuidv4()}.${sniffed}`;

    if (this.supabase) {
      const { error } = await this.supabase.storage
        .from('vendor-kyc')
        .upload(storageKey, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        throw new BadRequestException(`Upload failed: ${error.message}`);
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'Document storage is not configured. Try again later.',
      );
    }

    return {
      storageKey,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    };
  }

  /**
   * Issues a short-lived signed URL for a private KYC document. Falls back
   * to a dev placeholder when Supabase storage isn't configured locally.
   */
  async getSignedKycDocumentUrl(storageKey: string): Promise<string> {
    if (!this.supabase) {
      return `https://via.placeholder.com/600x800?text=${encodeURIComponent('dev-placeholder-document')}`;
    }
    const { data, error } = await this.supabase.storage
      .from('vendor-kyc')
      .createSignedUrl(storageKey, 300);

    if (error || !data?.signedUrl) {
      throw new BadRequestException('Could not generate document link. Try again later.');
    }
    return data.signedUrl;
  }

  async deleteVendorKycDocument(storageKey: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.storage.from('vendor-kyc').remove([storageKey]);
    if (error) {
      console.error('Failed to delete KYC document:', error.message);
    }
  }

  async deleteImage(url: string): Promise<void> {
    if (!this.supabase) return;

    // Extract file path from URL
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    // Find the bucket name in the path
    const bucketIndex = pathParts.findIndex(
      (p) => p === 'object' || p === 'public',
    );
    if (bucketIndex === -1) return;

    // Everything after the bucket name is the file path
    const filePath = pathParts.slice(bucketIndex + 2).join('/');

    const { error } = await this.supabase.storage
      .from('products')
      .remove([filePath]);

    if (error) {
      console.error('Failed to delete image:', error.message);
    }
  }
}
