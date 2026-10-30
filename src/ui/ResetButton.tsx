/** Кнопка «сброс» справа от подписи поля — общий кусок Toggle / Slider / Select из старого кита. */
export function ResetButton({ visible, text, onPress }: { visible: boolean; text: string; onPress: () => void }) {
  return (
    <span className="ui-reset-slot">
      {visible ? (
        <button
          type="button"
          className="ui-reset"
          onClick={(e) => {
            e.stopPropagation();
            onPress();
          }}
        >
          {text}
        </button>
      ) : null}
    </span>
  );
}
