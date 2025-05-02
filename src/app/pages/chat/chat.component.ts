import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MessageService } from '../../services/message.service';
import { CryptoService } from '../../services/crypto.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  
  private auth = inject(AuthService);
  private messageService = inject(MessageService);
  private cryptoService = inject(CryptoService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  
  messageForm: FormGroup = this.fb.group({
    message: ['', Validators.required]
  });
  
  currentUserId: string = '';
  users: any[] = [];
  conversations: any[] = [];
  messages: any[] = [];
  activeConversationId: string = '';
  activeChatPartnerName: string = '';
  
  private subscriptions: Subscription[] = [];
  
  ngOnInit() {
    this.loadCurrentUser();
    
    this.subscriptions.push(
      this.messageService.users$.subscribe(users => {
        this.users = users;
      }),
      
      this.messageService.conversations$.subscribe(conversations => {
        this.conversations = conversations;
      }),
      
      this.messageService.messages$.subscribe(messages => {
        this.messages = messages;
        this.scrollToBottom();
      })
    );
    
    this.messageService.loadUsers();
    this.messageService.loadConversations();
  }
  
  ngOnDestroy() {
    this.messageService.unsubscribe();
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
  
  async loadCurrentUser() {
    const user = await this.auth.getCurrentUser();
    if (user) {
      this.currentUserId = user.id;
    } else {
      this.router.navigate(['/login']);
    }
  }
  
  onLogOut() {
    this.auth.signOut().then(() => {
      this.router.navigate(['/login']);
    }).catch((err) => {
      console.log(err);
      alert(err);
    });
  }
  
  async startConversation(userId: string) {
    try {
      const conversationId = await this.messageService.findOrCreateConversation(userId);
      if (conversationId) {
        this.openConversation(conversationId);
      }
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  }
  
  async openConversation(conversationId: string) {
    this.activeConversationId = conversationId;
    
    let key = await this.cryptoService.getConversationKey(conversationId);
    if(!key){
      console.log("Error finding the encryption key, now generating new one");
      key = this.cryptoService.generateEncryptionKey();
      await this.cryptoService.storeConversationKey(conversationId, key);
    }
    console.log("This is the key generate for this user", this.currentUserId," the key: ", key);


    // Get participants for display name
    const participants = await this.messageService.getConversationParticipants(conversationId);
    console.log('Participants:', participants);
    
    // Find other user (not current user)
    const otherUser = participants.find(p => p.user_id !== this.currentUserId);
    
    if (otherUser && otherUser.profiles && otherUser.profiles[0]) {
      // Access the first element of the profiles array
      this.activeChatPartnerName = otherUser.profiles[0].display_name || otherUser.profiles[0].email;
    }
    
    // Subscribe to messages
    this.messageService.subscribeToConversation(conversationId);
  }
  
  backToList() {
    this.activeConversationId = '';
    this.activeChatPartnerName = '';
    this.messages = [];
    this.messageService.unsubscribe();
  }
  
  async sendMessage() {
    if (this.messageForm.invalid || !this.activeConversationId) return;
    
    const message = this.messageForm.value.message;
    try {
      await this.messageService.sendMessage(this.activeConversationId, message);
      this.messageForm.reset();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }
  
  getOtherUserName(conversation: any): string {
    if (!conversation.profiles) return 'Unknown';
    
    // In the updated query, profiles directly contains the other user's info
    return conversation.profiles.display_name || conversation.profiles.email || 'Unknown';
  }
  
  getConversationLastTime(conversation: any): string {
    if (!conversation.conversations?.updated_at) return '';
    return new Date(conversation.conversations.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  private scrollToBottom(): void {
    setTimeout(() => {
      try {
        if (this.scrollContainer) {
          this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
        }
      } catch (err) {
        console.error('Error scrolling to bottom:', err);
      }
    }, 100);
  }
}