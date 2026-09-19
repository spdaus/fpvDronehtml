export interface MenuItem {
  label: string;
  action: () => void;
}

/** Vertical menu driven by controller, keyboard or mouse. */
export class Menu {
  readonly el: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private items: MenuItem[] = [];
  private index = 0;

  constructor(parent: HTMLElement, items: MenuItem[]) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.setAttribute('role', 'menu');
    parent.appendChild(this.el);
    this.setItems(items);
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.el.replaceChildren();
    this.buttons = items.map((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.addEventListener('mouseenter', () => this.select(i));
      b.addEventListener('click', () => {
        this.select(i);
        this.activate();
      });
      this.el.appendChild(b);
      return b;
    });
    this.select(0);
  }

  select(i: number): void {
    this.index = (i + this.items.length) % this.items.length;
    this.buttons.forEach((b, k) => b.classList.toggle('selected', k === this.index));
  }

  move(delta: number): void {
    this.select(this.index + delta);
  }

  activate(): void {
    this.items[this.index]?.action();
  }
}
