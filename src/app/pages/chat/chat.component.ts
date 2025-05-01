import { Component, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  

  onLogOut(){
    this.auth.signOut().then((res)=>{
      this.router.navigate(['/login']);

    }).catch((err) => {
      console.log(err);
      alert(err);
    });
  }
}