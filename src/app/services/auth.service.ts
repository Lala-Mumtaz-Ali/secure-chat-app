import { inject, Injectable, NgZone } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment.development';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase!: SupabaseClient;
  private router = inject(Router);
  private _ngZone = inject(NgZone);

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    this.supabase = createClient(
      environment.supabaseURL,
      environment.supbaseAnoneKey
    );

    this.initializeUser();

    this.supabase.auth.onAuthStateChange((event, session) => {
      console.log("Event", event);
      console.log("Session", session);

      if (session?.user) {
        this.currentUserSubject.next(session.user);
        localStorage.setItem('session', JSON.stringify(session.user));

        this.createUserProfile(session.user);

        this._ngZone.run(() => {
          this.router.navigate(['/chat']);
        });
      } else {
        this.currentUserSubject.next(null);
        localStorage.removeItem('session');
      }
    });
  }

  // Restore user session from Supabase or localStorage
  private async initializeUser() {
    const { data } = await this.supabase.auth.getSession();
    if (data.session?.user) {
      this.currentUserSubject.next(data.session.user);
    } else {
      const userStr = localStorage.getItem('session');
      if (userStr && userStr !== 'undefined') {
        try {
          const user = JSON.parse(userStr);
          this.currentUserSubject.next(user);
        } catch (e) {
          localStorage.removeItem('session');
        }
      }
    }
  }

  // Create or update user profile in the Supabase "profiles" table
  private async createUserProfile(user: User) {
    const { error } = await this.supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        display_name: user.user_metadata?.['full_name'] || user.email?.split('@')[0],
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating user profile:', error);
    }
  }

  // Get Supabase client instance
  get supabaseClient(): SupabaseClient {
    return this.supabase;
  }

  // Check if user session exists in localStorage
  get stillSignedIn(): boolean {
    const user = localStorage.getItem('session');
    return user !== null && user !== 'undefined';
  }

  // Get the currently authenticated user
  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.supabase.auth.getUser();
    return data.user;
  }

  // Sign in using Google OAuth provider
  async signWithGoogle() {
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/chat`
      }
    });
  }

  // Sign out the user and clear session
  async signOut() {
    await this.supabase.auth.signOut();
    localStorage.removeItem('session');
    this.currentUserSubject.next(null);
    return this.router.navigate(['/login']);
  }

  // Subscribe to authentication state changes
  getAuthChanges() {
    return this.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        this._ngZone.run(() => {
          this.router.navigate(['/login']);
        });
      }
    });
  }
}
