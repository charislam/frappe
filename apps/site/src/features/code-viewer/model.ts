export interface SourceFile {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly source: string;
  /** Escaped HTML produced by the trusted build-time Shiki pipeline. */
  readonly html: string;
}
export type SourceFiles = readonly [SourceFile, ...SourceFile[]];
export const selectedFile = (options: { files: SourceFiles; selected: string }): SourceFile =>
  options.files.find((file) => file.id === options.selected) ?? options.files[0];

export interface SourceSet {
  readonly files: SourceFiles;
  readonly subscribe: (listener: (files: SourceFiles) => void) => () => void;
}
