/**
 * HUD Controller
 */
export class HUD {
  constructor() {
    this.scoreRedText = document.getElementById('score-red-text');
    this.scoreBlueText = document.getElementById('score-blue-text');
    this.hudTimerText = document.getElementById('hud-timer-text');
    this.hpBarFill = document.getElementById('hp-bar-fill');
    this.ammoText = document.getElementById('ammo-text');
    this.killFeed = document.getElementById('kill-feed');
  }

  update(state, myUserId) {
    if (!state) return;

    if (this.scoreRedText) this.scoreRedText.innerText = `RED: ${state.redScore}`;
    if (this.scoreBlueText) this.scoreBlueText.innerText = `BLUE: ${state.blueScore}`;

    // Format time
    const mins = Math.floor(state.timeRemaining / 60);
    const secs = Math.floor(state.timeRemaining % 60);
    const formattedTime = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    if (this.hudTimerText) this.hudTimerText.innerText = formattedTime;

    // Find local player
    const me = state.players.find(p => p.slot === state.mySlot);
    if (me) {
      if (this.hpBarFill) {
        this.hpBarFill.style.width = `${me.hp}%`;
        if (me.hp < 30) this.hpBarFill.style.backgroundColor = '#ef4444';
        else if (me.hp < 60) this.hpBarFill.style.backgroundColor = '#f59e0b';
        else this.hpBarFill.style.backgroundColor = '#22c55e';
      }

      if (this.ammoText) {
        if (me.reloading) {
          this.ammoText.innerText = 'RELOADING...';
        } else {
          this.ammoText.innerText = `${me.ammo} / 30`;
        }
      }
    }
  }

  addKillFeed(text) {
    if (!this.killFeed) return;
    const item = document.createElement('div');
    item.className = 'kill-item';
    item.innerText = text;
    this.killFeed.appendChild(item);

    setTimeout(() => {
      item.remove();
    }, 4000);
  }
}
