import type { PortfolioModel } from './model';
import { mergeModels, parseXerFile } from './xer/buildModel';

export interface InputFile {
  name: string;
  data: ArrayBuffer | Uint8Array | string;
}

/** Parse several XER files into one portfolio model. Invalid files are reported, never thrown. */
export function loadPortfolio(files: InputFile[]): PortfolioModel {
  const parts = files.map((f, i) => parseXerFile(f.data, `f${i + 1}`, f.name).model);
  return mergeModels(parts);
}
