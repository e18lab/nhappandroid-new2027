/**
 * Результаты поиска по картинке — режим `explore?imsearch=1` старого приложения отдельным экраном.
 * Файл выбирается на экране поиска (`useImagePicker`) и лежит в `lib/imageSearch.ts`.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Book } from "../api/book";
import { BookCollection } from "../components/BookCollection";
import { useI18n } from "../i18n/I18nContext";
import { getImageSearch, runImageSearch, startImageSearch } from "../lib/imageSearch";
import { useStableCallback } from "../lib/useStableCallback";
import { LoadingSpinner, NoResultsPanel } from "../ui";

/** Выбор картинки: скрытое поле и функция, открывающая системный выбор файла. */
export function useImagePicker(replace = false) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) navigate(`/image-search?t=${startImageSearch(file)}`, { replace });
      }}
    />
  );
  return { element, pick: () => input.current?.click() };
}

export function ImageSearchScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("t");
  const picker = useImagePicker(true);
  const [books, setBooks] = useState<Book[] | null>(() => getImageSearch(token)?.books ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const session = getImageSearch(token);

  useEffect(() => {
    const current = getImageSearch(token);
    setError(null);
    setBooks(current?.books ?? null);
    if (!current || current.books) return;
    const abort = new AbortController();
    runImageSearch(current, abort.signal)
      .then((found) => {
        if (!abort.signal.aborted) setBooks(found);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => abort.abort();
  }, [token, retry]);

  const openBook = useStableCallback((book: Book) => navigate(`/book/${book.id}?title=${encodeURIComponent(book.title.pretty)}`));
  const readBook = useStableCallback((book: Book) => navigate(`/read/${book.id}`));

  const pickOther = { label: t("search.imageSearchPickOther"), onPress: picker.pick };
  let body;
  if (!session || error || books?.length === 0) {
    body = (
      <NoResultsPanel
        title={t("search.imageSearchResultsTitle")}
        subtitle={!session ? t("search.imageSearchNoPayload") : (error ?? t("search.imageSearchNoMatches"))}
        iconName="image"
        actions={error ? [{ label: t("search.imageSearchRetry"), onPress: () => setRetry((n) => n + 1) }, pickOther] : [pickOther]}
      />
    );
  } else if (!books) {
    body = (
      <div className="error-block">
        <LoadingSpinner />
        <p>{t("search.imageSearchBusy")}</p>
      </div>
    );
  } else {
    body = (
      <div className="screen-scroll ax-feed">
        <BookCollection books={books} onPress={openBook} onRead={readBook} />
      </div>
    );
  }

  return (
    <div className="screen-fill">
      {picker.element}
      {body}
    </div>
  );
}
