import { Component } from "react";

// A slide that fails to render must cost you THAT SLIDE, not the deck.
//
// Without a boundary, any throw below `.deck-body` unmounts the whole React tree
// and the window goes white — no chrome, no arrow keys, no way on except a reload.
// That is the worst possible failure for a deck: it happens in front of a room.
//
// The markdown renderer is the realistic source. It runs author content through
// remark/rehype IN THE BROWSER, and `MarkdownHooks` rethrows a plugin failure
// during render, so a diagram that a particular browser can't draw arrives here as
// a render-time exception.
//
// It sits INSIDE the canvas, so the deck's chrome, keyboard handler, and swipe
// navigation all keep working — you can move past a broken slide and carry on. And
// it deliberately shows the message rather than only logging it: the browser that
// fails may well be a phone, where nobody has a console attached.
export class SlideErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Still log for the case where someone IS at a desk.
    console.error("Slide failed to render", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="deck-slide-error" role="alert">
        <p className="deck-slide-error-title">
          This slide could not be rendered
        </p>
        <p className="deck-slide-error-message">
          {error.message || String(error)}
        </p>
        <p className="deck-slide-error-hint">Swipe or press → to continue.</p>
      </div>
    );
  }
}
