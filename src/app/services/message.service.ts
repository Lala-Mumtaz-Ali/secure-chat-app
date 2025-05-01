import { inject, Injectable } from '@angular/core';
import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { CryptoService } from './crypto.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';



@Injectable({
  providedIn: 'root'
})


export class MessageService {
  private auth = inject(AuthService);
  private cryptoService = inject(CryptoService);
  
  private supabase = this.auth.supabaseClient;
  private messagesSubject = new BehaviorSubject<any[]>([]);
  private usersSubject = new BehaviorSubject<any[]>([]);
  private conversationsSubject = new BehaviorSubject<any[]>([]);
  
  public messages$ = this.messagesSubject.asObservable();
  public users$ = this.usersSubject.asObservable();
  public conversations$ = this.conversationsSubject.asObservable();
  
  private activeChannel: RealtimeChannel | null = null;
  
  constructor() {
    this.loadUsers();
  }
  
  // Load all available users
  async loadUsers() {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return;
    
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .neq('id', currentUser.id);
      
    if (error) {
      console.error('Error loading users:', error);
      return;
    }
    
    this.usersSubject.next(data);
  }
  
  // Load user conversations
  async loadConversations() {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return;
    
    const { data, error } = await this.supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        conversations:conversation_id(id, created_at, updated_at),
        profiles:user_id!inner(id, display_name, email)
      `)
      .eq('user_id', currentUser.id);
      
    if (error) {
      console.error('Error loading conversations:', error);
      return;
    }
    
    console.log('Loaded conversations:', data);
    this.conversationsSubject.next(data);
    return data;
  }
  
  // Create a new conversation
  async createConversation(otherUserId: string) {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return null;
    
    // Create conversation
    const { data: conversation, error: conversationError } = await this.supabase
      .from('conversations')
      .insert({})
      .select()
      .single();
      
    if (conversationError) {
      console.error('Error creating conversation:', conversationError);
      return null;
    }
    
    // Add participants
    const participants = [
      { conversation_id: conversation.id, user_id: currentUser.id },
      { conversation_id: conversation.id, user_id: otherUserId }
    ];
    
    const { error: participantsError } = await this.supabase
      .from('conversation_participants')
      .insert(participants);
      
    if (participantsError) {
      console.error('Error adding participants:', participantsError);
      return null;
    }
    
    // Generate and store encryption key for this conversation
    const key = this.cryptoService.generateEncryptionKey();
    this.cryptoService.storeConversationKey(conversation.id, key);
    
    await this.loadConversations();
    return conversation.id;
  }
  
  // Find or create conversation with user
  async findOrCreateConversation(otherUserId: string) {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return null;
    
    // Check if conversation exists
    const { data, error } = await this.supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        conversations!inner(*)
      `)
      .eq('user_id', currentUser.id);
      
    if (error) {
      console.error('Error finding conversations:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      // Check if any of these conversations include the other user
      for (const conv of data) {
        const { data: participants, error: participantsError } = await this.supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conv.conversation_id)
          .eq('user_id', otherUserId);
          
        if (!participantsError && participants && participants.length > 0) {
          // Found existing conversation
          return conv.conversation_id;
        }
      }
    }
    
    // No conversation found, create new one
    return this.createConversation(otherUserId);
  }
  
  // Get conversation participants
  async getConversationParticipants(conversationId: string) {
    const { data, error } = await this.supabase
      .from('conversation_participants')
      .select(`
        user_id,
        profiles:user_id(id, display_name, email)
      `)
      .eq('conversation_id', conversationId);
      
    if (error) {
      console.error('Error getting participants:', error);
      return [];
    }
    
    return data;
  }
  
  // Send message in conversation
  async sendMessage(conversationId: string, content: string) {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) return null;
    
    // Get encryption key for this conversation
    const key = this.cryptoService.getConversationKey(conversationId);
    if (!key) {
      console.error('No encryption key found for conversation');
      return null;
    }
    
    // Encrypt message
    const { ciphertext, iv } = this.cryptoService.encryptMessage(content, key);
    
    // Send encrypted message
    const { data, error } = await this.supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        encrypted_content: ciphertext,
        iv: iv
      })
      .select()
      .single();
      
    if (error) {
      console.error('Error sending message:', error);
      return null;
    }
    
    return data;
  }
  
  // Subscribe to conversation messages
  subscribeToConversation(conversationId: string) {
    // First load existing messages
    this.loadMessages(conversationId);
    
    // Unsubscribe from any previous channel
    if (this.activeChannel) {
      this.supabase.removeChannel(this.activeChannel);
    }
    
    // Subscribe to new messages
    this.activeChannel = this.supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes', 
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        }, 
        () => {
          // New message arrived, reload messages
          this.loadMessages(conversationId);
        }
      )
      .subscribe();
  }
  
  // Load messages for a conversation
  async loadMessages(conversationId: string) {
    // Get encryption key
    const key = this.cryptoService.getConversationKey(conversationId);
    if (!key) {
      console.error('No encryption key found for conversation');
      this.messagesSubject.next([]);
      return;
    }
    
    // Load messages
    const { data, error } = await this.supabase
      .from('messages')
      .select(`
        *,
        profiles:sender_id(display_name, email)
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
      
    if (error) {
      console.error('Error loading messages:', error);
      this.messagesSubject.next([]);
      return;
    }
    
    // Decrypt messages
    const decryptedMessages = data.map(msg => {
      try {
        const decryptedContent = this.cryptoService.decryptMessage(
          msg.encrypted_content,
          msg.iv,
          key
        );
        
        return {
          ...msg,
          content: decryptedContent
        };
      } catch (e) {
        console.error('Error decrypting message:', e);
        return {
          ...msg,
          content: '[Encrypted message]'
        };
      }
    });
    
    this.messagesSubject.next(decryptedMessages);
  }
  
  // Cleanup on component destroy
  unsubscribe() {
    if (this.activeChannel) {
      this.supabase.removeChannel(this.activeChannel);
      this.activeChannel = null;
    }
  }
  
}