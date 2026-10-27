import React from "react";
import { FilePane, type FilePaneProps } from "../../src/components/FilePane";
import type { FileViewState } from "../../src/types";

/**
 * Test-only adapter for the file panel: the panel's real contract is
 * `files` + `activeFileId` (spec「文件面板已打开文件的标签」), but the legacy
 * suites describe a single open file as one `FileViewState`. This renders the
 * exactly-one-open-file case so those suites keep reading as one file each;
 * the multi-tab behaviour itself is covered in `filePaneTabs.test.tsx`.
 */
export type SingleFilePaneProps = Omit<
  FilePaneProps,
  "files" | "activeFileId"
> & {
  /** The one open file; null = the panel has no open file at all. */
  fileView: FileViewState | null;
};

export const SingleFilePane: React.FC<SingleFilePaneProps> = ({
  fileView,
  ...rest
}) => (
  <FilePane
    files={
      fileView
        ? [
            {
              id: "f1",
              path: fileView.path,
              startLine: fileView.startLine,
              endLine: fileView.endLine,
              fileView,
            },
          ]
        : []
    }
    activeFileId={fileView ? "f1" : undefined}
    {...rest}
  />
);
