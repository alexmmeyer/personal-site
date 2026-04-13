(() => {
  const primaryBtns = document.querySelectorAll(".primary-nav__btn");
  const secondaryBtns = document.querySelectorAll(".secondary-nav__btn");
  const panels = document.querySelectorAll(".content-panel");

  function showPanel(id) {
    panels.forEach((p) => {
      p.hidden = p.id !== id;
    });
  }

  function closeAllCategories() {
    document.querySelectorAll(".primary-nav__item").forEach((item) => {
      item.classList.remove("is-open");
      const btn = item.querySelector(".primary-nav__btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
      const sub = item.querySelector(".secondary-nav");
      if (sub) sub.setAttribute("aria-hidden", "true");
    });
  }

  primaryBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".primary-nav__item");
      const isOpen = item.classList.contains("is-open");

      closeAllCategories();

      if (!isOpen) {
        item.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        const sub = item.querySelector(".secondary-nav");
        if (sub) sub.setAttribute("aria-hidden", "false");
      }

      // If closing, return to default panel; if opening with no project yet, show default
      const activeSecondary = item.querySelector(".secondary-nav__btn.is-active");
      if (!isOpen && !activeSecondary) {
        showPanel("panel-default");
      } else if (isOpen) {
        showPanel("panel-default");
        secondaryBtns.forEach((s) => s.classList.remove("is-active"));
      }
    });
  });

  secondaryBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      secondaryBtns.forEach((s) => s.classList.remove("is-active"));
      btn.classList.add("is-active");
      const project = btn.dataset.project;
      showPanel(`panel-${project}`);
    });
  });
})();
