import { useMemo, useState } from "react";
import { useWorkshop, useVariables } from "@dockersamples/simspace-labspace";
import { DeckContext } from "../../context/DeckContext";
import { SlideBleedImage, SlideRegions, SlideChrome } from "../Deck/DeckView";
import { SlideErrorBoundary } from "../Deck/SlideErrorBoundary";
import { deriveSlidePresentation } from "../../deck/deriveSlide";
import "../Deck/DeckView.scss";
import "./DeckExportView.scss";

// The print/export view for a `kind: slides` entry: every slide, in its own
// slide-rendered look, laid out for printing rather than presenting.
//
// DeckContext is router-driven — it only ever knows "the current slide". This
// view needs ALL of them at once, so each slide gets its own synthetic
// DeckContext value (computed by the same `deriveSlidePresentation` DeckContext
// itself calls) and is rendered through the exact same components DeckView
// uses (SlideBleedImage, SlideChrome, SlideRegions) — so a printed slide is
// pixel-for-pixel the deck's own look, not a second implementation of it.
//
// Fragments need no special handling: FragmentContext defaults to "everything
// revealed" for exactly this case (see FragmentContext.jsx).
export function DeckExportView() {
  const workshop = useWorkshop();
  const { variables } = useVariables();
  const [perPage, setPerPage] = useState(2);

  const slides = useMemo(
    () => (workshop.sections || []).flatMap((section) => section.slides || []),
    [workshop],
  );

  const total = slides.length;

  const pages = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < slides.length; i += perPage) {
      chunks.push(slides.slice(i, i + perPage));
    }
    return chunks;
  }, [slides, perPage]);

  return (
    <div className="deck-export">
      <div className="deck-export-controls no-print">
        <span>{workshop.title} — Print View</span>
        <div
          className="deck-export-perpage"
          role="group"
          aria-label="Slides per page"
        >
          {[1, 2].map((n) => (
            <button
              key={n}
              type="button"
              className={perPage === n ? "active" : ""}
              onClick={() => setPerPage(n)}
            >
              {n} per page
            </button>
          ))}
        </div>
      </div>

      {pages.map((pageSlides, pageIndex) => (
        <div
          className={`deck-export-page deck-export-page--${pageSlides.length}`}
          key={pageSlides[0]?.id ?? pageIndex}
        >
          {pageSlides.map((slide, i) => (
            <ExportSlide
              key={slide.id}
              slide={slide}
              index={pageIndex * perPage + i}
              total={total}
              workshop={workshop}
              variables={variables}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ExportSlide({ slide, index, total, workshop, variables }) {
  const presentation = deriveSlidePresentation(slide, { workshop, variables });
  const { layout, theme } = presentation;

  const value = {
    ...presentation,
    current: slide,
    index,
    total,
    fragment: Infinity,
    fragmentCount: 0,
  };

  return (
    <div className="deck-export-slide">
      <DeckContext.Provider value={value}>
        <article
          className={`deck-canvas deck-canvas--${layout} deck-canvas--${theme}`}
        >
          <SlideBleedImage />
          <div className="deck-frame">
            <SlideChrome position="top" />
            <div className="deck-body">
              <SlideErrorBoundary>
                <SlideRegions />
              </SlideErrorBoundary>
            </div>
            <SlideChrome position="bottom" />
          </div>
        </article>
      </DeckContext.Provider>
    </div>
  );
}
