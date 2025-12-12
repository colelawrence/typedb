import type React from "react";

import { useTodoVM } from "../TodoVMContext.tsx";
import { Queryable } from "./Queryable.tsx";

export const Footer: React.FC = () => {
  const vm = useTodoVM();
  return (
    <footer $="footer">
      <span $="todo-count">
        <Queryable query={vm.footer.incompleteDisplayText$} />
      </span>
      <ul $="filters">
        <Queryable query={vm.footer.currentFilter$}>
          {(filter) => (
            <>
              <li $>
                <a href="#/" $={filter === "all" ? "selected" : ""} onClick={vm.footer.showAll}>
                  All
                </a>
              </li>
              <li $>
                <a href="#/" $={filter === "active" ? "selected" : ""} onClick={vm.footer.showActive}>
                  Active
                </a>
              </li>
              <li $>
                <a href="#/" $={filter === "completed" ? "selected" : ""} onClick={vm.footer.showCompleted}>
                  Completed
                </a>
              </li>
            </>
          )}
        </Queryable>
      </ul>
      <button type="button" $="clear-completed" onClick={vm.footer.clearCompleted}>
        Clear completed
      </button>
    </footer>
  );
};
