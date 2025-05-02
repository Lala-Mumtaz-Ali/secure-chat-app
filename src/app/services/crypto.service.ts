import { inject, Injectable } from '@angular/core';
import * as CryptoJS from 'crypto-js';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})

export class CryptoService {

  private auth = inject(AuthService);
  private supabase = this.auth.supabaseClient;
  
  generateEncryptionKey(): string {
    const keyBytes = CryptoJS.lib.WordArray.random(32); // 256-bit key
    return keyBytes.toString(CryptoJS.enc.Base64);
  }
  
  async storeConversationKey(conversationId: string, key: string): Promise<void> {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return;
  
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(key, currentUser.id, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
  
    // Check if the record exists
    const { data: existing, error: fetchError } = await this.supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUser.id)
      .single();
  
    if (fetchError && fetchError.code !== 'PGRST116') { // 'PGRST116' = no rows returned
      console.error('Error checking existing participant:', fetchError);
      return;
    }
  
    if (existing) {
      // Update existing record
      const { error: updateError } = await this.supabase
        .from('conversation_participants')
        .update({
          encrypted_key: encrypted.toString(),
          iv: iv.toString(CryptoJS.enc.Base64)
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', currentUser.id);
  
      if (updateError) {
        console.error('Error updating conversation key:', updateError);
      }
    } else {
      // Insert new record
      const { error: insertError } = await this.supabase
        .from('conversation_participants')
        .insert({
          conversation_id: conversationId,
          user_id: currentUser.id,
          encrypted_key: encrypted.toString(),
          iv: iv.toString(CryptoJS.enc.Base64)
        });
  
      if (insertError) {
        console.error('Error inserting conversation key:', insertError);
      }
    }
  }
  
  

  async getConversationKey(conversationId: string): Promise<string | null> {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return null;
  
    // Try fetching current user's key
    const { data: ownRecord, error: ownError } = await this.supabase
      .from('conversation_participants')
      .select('encrypted_key, iv')
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUser.id)
      .single();
  
    if (!ownError && ownRecord?.encrypted_key && ownRecord?.iv) {
      try {
        const ivWordArray = CryptoJS.enc.Base64.parse(ownRecord.iv);
        const decrypted = CryptoJS.AES.decrypt(ownRecord.encrypted_key, currentUser.id, {
          iv: ivWordArray,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        });
        return decrypted.toString(CryptoJS.enc.Utf8);
      } catch (e) {
        console.error('Key decryption failed for current user', e);
        return null;
      }
    }
  
    // Try to find another participant and reuse their key
    const { data: others, error: otherError } = await this.supabase
      .from('conversation_participants')
      .select('user_id, encrypted_key, iv')
      .eq('conversation_id', conversationId)
      .neq('user_id', currentUser.id);
  
    if (otherError) {
      console.error('Error checking other participants', otherError);
      return null;
    }
  
    const otherParticipant = others?.find(participant => participant.encrypted_key && participant.iv);
  
    if (otherParticipant) {
      try {
        // Decrypt their key using their user_id
        const iv = CryptoJS.enc.Base64.parse(otherParticipant.iv);
        const decryptedKey = CryptoJS.AES.decrypt(otherParticipant.encrypted_key, otherParticipant.user_id, {
          iv: iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        }).toString(CryptoJS.enc.Utf8);
  
        // Re-encrypt with current user's ID
        await this.storeConversationKey(conversationId, decryptedKey);
        return decryptedKey;
      } catch (e) {
        console.error('Failed to re-encrypt other user’s key', e);
        return null;
      }
    }
  
    // No other user with a key found — create a new key
    const newKey = this.generateEncryptionKey();
    await this.storeConversationKey(conversationId, newKey);
    return newKey;
  }
  
  // Encrypt message with AES
  encryptMessage(message: string, key: string): { ciphertext: string, iv: string } {
    const iv = CryptoJS.lib.WordArray.random(16);
    
    const encrypted = CryptoJS.AES.encrypt(message, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    return {
      ciphertext: encrypted.toString(),
      iv: iv.toString(CryptoJS.enc.Base64)
    };
  }
  
  // Decrypt message with AES
  decryptMessage(ciphertext: string, iv: string, key: string): string {
    try {
      const ivWordArray = CryptoJS.enc.Base64.parse(iv);
      const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
        iv: ivWordArray,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      
      console.log("Now tring to Decrypt")

      console.log(decrypted.toString(CryptoJS.enc.Utf8))
      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      console.error('Decryption failed', e);
      return '[Encrypted message - cannot decrypt]';
    }
  }
  
}