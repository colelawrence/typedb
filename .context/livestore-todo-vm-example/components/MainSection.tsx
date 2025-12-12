import type React from "react";
import { useRef } from "react";

import { DevState } from "#scripts/lib/dev/DevState.tsx";
import { MountDebugComponent } from "#scripts/lib/dev/MountDebugComponent.tsx";
import { useTodoVM } from "../TodoVMContext.tsx";
import { Queryable } from "./Queryable.tsx";

// #region todo-vm-ui-livestore
export const MainSection: React.FC = () => {
  const vm = useTodoVM();
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} $="todos">
      {/* #hide debugs */}
      <MountDebugComponent
        id="!visibleTodos"
        debugKey="devstate"
        render={<DevState $ data={vm.itemList.items$} name="Todos" />}
      />
      {/* #endhide debugs */}
      <ul $="todo-list">
        <Queryable query={vm.itemList.items$}>
          {(items) =>
            items.map((item) => (
              <li $="state" key={item.key}>
                <Queryable query={item.completed$}>
                  {(completed) => (
                    <input $="toggle" type="checkbox" checked={completed} onChange={() => item.toggleCompleted()} />
                  )}
                </Queryable>
                <label $>
                  <Queryable query={item.text$} />
                </label>
                <button type="button" $="destroy" onClick={() => item.remove()} />
              </li>
            ))
          }
        </Queryable>
      </ul>
    </section>
  );
};
// #endregion todo-vm-ui-livestore
