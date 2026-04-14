(() => {
  const primaryBtns = document.querySelectorAll(".primary-nav__btn");
  const secondaryBtns = document.querySelectorAll(".secondary-nav__btn");
  const panels = document.querySelectorAll(".content-panel");

  function showPanel(id) {
    panels.forEach((p) => {
      p.hidden = p.id !== id;
    });
  }

  function animateItemsIn(sub, btn) {
    const items = sub.querySelectorAll("li");

    // Reset animation state
    items.forEach((li) => {
      li.classList.remove("is-visible");
      li.style.removeProperty("--fall-from");
    });

    const btnRect = btn.getBoundingClientRect();

    // Double rAF: first frame kicks off the max-height transition so items
    // have layout positions; second frame gives stable getBoundingClientRect.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        items.forEach((li) => {
          const liRect = li.getBoundingClientRect();
          // Negative value = how far up from rest position to the btn top
          const dist = liRect.top - btnRect.top;
          li.style.setProperty("--fall-from", `${-dist}px`);
        });

        // Last item fires first
        items.forEach((li, i) => {
          setTimeout(
            () => li.classList.add("is-visible"),
            (items.length - 1 - i) * 120
          );
        });
      });
    });
  }

  function closeAllCategories() {
    document.querySelectorAll(".primary-nav__item").forEach((item) => {
      item.classList.remove("is-open");
      const btn = item.querySelector(".primary-nav__btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
      const sub = item.querySelector(".secondary-nav");
      if (sub) {
        sub.setAttribute("aria-hidden", "true");
        sub.querySelectorAll("li").forEach((li) => li.classList.remove("is-visible"));
      }
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
        if (sub) {
          sub.setAttribute("aria-hidden", "false");
          animateItemsIn(sub, btn);
        }
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
