const buttons = document.querySelectorAll<HTMLButtonElement>('nav button');
const sections = document.querySelectorAll<HTMLElement>('main section, body > section');

for (const button of buttons) {
  button.addEventListener('click', () => {
    const target = button.dataset.section;
    for (const b of buttons) {
      b.setAttribute('aria-current', String(b === button));
    }
    for (const section of sections) {
      section.hidden = section.id !== target;
    }
  });
}
