import { Injectable } from '@angular/core';
import * as CryptoJS from 'crypto-js';

@Injectable({
  providedIn: 'root'
})

export class CryptoService {
  // Generate a random encryption key
  generateEncryptionKey(): string {
    const keyBytes = CryptoJS.lib.WordArray.random(32); // 256-bit key
    return keyBytes.toString(CryptoJS.enc.Base64);
  }
  
  // Store conversation key in local storage
  storeConversationKey(conversationId: string, key: string): void {
    const keys = this.getStoredKeys();
    keys[conversationId] = key;
    localStorage.setItem('conversationKeys', JSON.stringify(keys));
  }
  
  // Get all stored keys
  getStoredKeys(): Record<string, string> {
    const keysJson = localStorage.getItem('conversationKeys');
    if (keysJson) {
      try {
        return JSON.parse(keysJson);
      } catch (e) {
        console.error('Error parsing stored keys', e);
        return {};
      }
    }
    return {};
  }
  
  // Get key for specific conversation
  getConversationKey(conversationId: string): string | null {
    const keys = this.getStoredKeys();
    return keys[conversationId] || null;
  }
  
  // Encrypt message with AES
  encryptMessage(message: string, key: string): { ciphertext: string, iv: string } {
    const iv = CryptoJS.lib.WordArray.random(16); // Generate random IV
    
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
      
      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      console.error('Decryption failed', e);
      return '[Encrypted message - cannot decrypt]';
    }
  }
  
}