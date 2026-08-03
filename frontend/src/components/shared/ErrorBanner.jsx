export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2.5 flex items-center justify-between">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400 hover:text-red-600 ml-4 font-bold">
          ✕
        </button>
      )}
    </div>
  );
}
