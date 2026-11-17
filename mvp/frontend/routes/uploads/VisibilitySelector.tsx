import { useEffect, useRef, useState } from "react";
export type Visibility = "private" | "unlisted" | "public";
export function VisibilitySelector(
  { value, onChange, disabled = false }: {
    value: Visibility;
    onChange: (value: Visibility) => void;
    disabled?: boolean;
  },
) {
  const dialog = useRef<HTMLDialogElement>(null), select = useRef<HTMLSelectElement>(null);
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    if (warning) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [warning]);
  const close = () => {
    dialog.current?.close();
    setWarning(false);
    select.current?.focus();
  };
  return (
    <>
      <label>
        YouTube visibility{" "}
        <select
          ref={select}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as Visibility;
            if (next === "public" && value !== "public") setWarning(true);
            else onChange(next);
          }}
        >
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </label>
      <p>
        Unlisted videos can be watched and shared by anyone with the link. Private videos cannot be
        used for QR codes.
      </p>
      <dialog
        ref={dialog}
        aria-labelledby="public-warning-title"
        aria-describedby="public-warning-description"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h3 id="public-warning-title">Use Public visibility?</h3>
        <p id="public-warning-description">
          Public videos can be found and watched by anyone on YouTube and may appear in search
          results or on your channel.
        </p>
        <button type="button" autoFocus onClick={close}>Cancel</button>{" "}
        <button
          type="button"
          onClick={() => {
            onChange("public");
            close();
          }}
        >
          Use Public
        </button>
      </dialog>
    </>
  );
}
