export function RenderedSvg({ children, ...rest }) {
  return <svg {...rest}>{children}</svg>;
}
