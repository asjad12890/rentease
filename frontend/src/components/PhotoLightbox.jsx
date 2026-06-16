import { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';

export default function PhotoLightbox({ src, alt = 'Photo', onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition"
        >
          <X size={24} />
        </button>
        <img
          src={src}
          alt={alt}
          className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
        />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-3 right-3 flex items-center gap-1 px-3 py-1.5 bg-black/50 text-white/80 hover:text-white rounded-lg text-xs transition"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={11} /> Open in tab
        </a>
      </div>
    </div>
  );
}
