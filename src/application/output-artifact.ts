export interface OutputArtifactWriter {
  writeExclusive(outputPath: string, content: string): Promise<void>;
}
