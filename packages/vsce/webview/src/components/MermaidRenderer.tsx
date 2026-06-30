import React, { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import '../styles/MermaidRenderer.css';

interface MermaidRendererProps {
  content: string;
  className?: string;
  vscode: { postMessage: (msg: unknown) => void };
}

interface FullscreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgContent: string;
  originalContent: string;
  vscode: { postMessage: (msg: unknown) => void };
}

let mermaidInitialized = false;

// Clean and validate mermaid syntax
const cleanMermaidSyntax = (content: string): string => {
  return content
    .trim()
    // Remove trailing semicolons which can cause issues
    .replace(/;\s*$/gm, '')
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    // Remove extra whitespace
    .replace(/\s+$/gm, '');
};

const FullscreenModal: React.FC<FullscreenModalProps> = ({ isOpen, onClose, svgContent, originalContent: _originalContent, vscode }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prevScale => Math.max(0.1, Math.min(5, prevScale + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      const contentEl = contentRef.current;
      if (contentEl) {
        contentEl.addEventListener('wheel', handleWheel, { passive: false });
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        if (contentEl) {
          contentEl.removeEventListener('wheel', handleWheel);
        }
      };
    }
  }, [isOpen, handleWheel, handleMouseMove, handleMouseUp, onClose]);

  const downloadSvg = () => {
    vscode.postMessage({
      command: 'downloadMermaid',
      content: svgContent,
      format: 'svg'
    });
  };

  const downloadPng = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    
    // Use base64 data URL for SVG to avoid some security/tainting issues
    // and ensure it's self-contained
    const svgBase64 = btoa(unescape(encodeURIComponent(svgContent)));
    const url = `data:image/svg+xml;base64,${svgBase64}`;

    img.onload = () => {
      // Create a temporary SVG element to measure its actual size
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svgElement = svgDoc.documentElement;
      
      // Try to get dimensions from SVG attributes
      let width = parseFloat(svgElement.getAttribute('width') || '0');
      let height = parseFloat(svgElement.getAttribute('height') || '0');
      const viewBox = svgElement.getAttribute('viewBox');
      let viewBoxWidth = 0;
      let viewBoxHeight = 0;

      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(parseFloat);
        if (parts.length === 4) {
          viewBoxWidth = parts[2];
          viewBoxHeight = parts[3];
        }
      }

      // If width/height are percentages or missing, use viewBox
      if (!width || isNaN(width) || svgElement.getAttribute('width')?.includes('%')) {
        width = viewBoxWidth || img.naturalWidth || img.width || 800;
      }
      if (!height || isNaN(height) || svgElement.getAttribute('height')?.includes('%')) {
        height = viewBoxHeight || img.naturalHeight || img.height || 600;
      }

      // Final check to maintain aspect ratio if one dimension is still missing
      if (viewBoxWidth && viewBoxHeight) {
        const aspectRatio = viewBoxWidth / viewBoxHeight;
        if (width && !height) height = width / aspectRatio;
        else if (!width && height) width = height * aspectRatio;
      }

      // Fallback to defaults
      width = width || 800;
      height = height || 600;
      
      canvas.width = width * 2; // Higher resolution
      canvas.height = height * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width, height);
      
      try {
        const pngDataUrl = canvas.toDataURL('image/png');
        vscode.postMessage({
          command: 'downloadMermaid',
          content: pngDataUrl,
          format: 'png'
        });
      } catch (err) {
        console.error('Failed to export canvas to PNG:', err);
        vscode.postMessage({
          command: 'showError',
          message: '由于浏览器安全限制，无法生成 PNG。这通常是因为图表中包含了复杂的 HTML 标签。请尝试下载 SVG 格式。'
        });
      }
    };
    img.src = url;
  };

  const resetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="mermaid-fullscreen-modal"
      ref={modalRef}
      onClick={(e) => e.target === modalRef.current && onClose()}
    >
      <div className="fullscreen-header">
        <div className="fullscreen-controls">
          <button onClick={downloadSvg} className="control-btn" title="下载 SVG">
            <i className="codicon codicon-file-code"></i> SVG
          </button>
          <button onClick={downloadPng} className="control-btn" title="下载 PNG">
            <i className="codicon codicon-file-media"></i> PNG
          </button>
          <button onClick={resetView} className="control-btn" title="重置视图">
            <i className="codicon codicon-refresh"></i> 重置
          </button>
          <span className="zoom-info">{Math.round(scale * 100)}%</span>
        </div>
        <button onClick={onClose} className="close-btn" title="关闭 (ESC)">
          ✕
        </button>
      </div>
      
      <div 
        className="fullscreen-content"
        ref={contentRef}
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div 
          className="fullscreen-diagram"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: 'center center'
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
      
      <div className="fullscreen-help">
        滚轮缩放 | 拖拽移动 | ESC关闭
      </div>
    </div>
  );
};

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ content, className = '', vscode }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'source'>('preview');
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<NodeJS.Timeout>();
  const cleanedContent = useRef<string>('');
  const lastRenderedContent = useRef<string>(''); // Track what was last rendered

  // Initialize mermaid configuration once
  useEffect(() => {
    if (!mermaidInitialized) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          htmlLabels: false,
          fontFamily: 'var(--vscode-font-family, monospace)',
          deterministicIds: true,
          deterministicIDSeed: 'wave-vscode',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: false,
            curve: 'basis'
          },
          sequence: {
            useMaxWidth: true,
            wrap: true,
            showSequenceNumbers: true
          },
          gantt: {
            useMaxWidth: true,
            leftPadding: 75,
            gridLineStartPadding: 35
          },
          class: {
            useMaxWidth: true
          },
          state: {
            useMaxWidth: true
          },
          pie: {
            useMaxWidth: true
          },
          logLevel: 'error',
          suppressErrorRendering: true,
          maxTextSize: 50000,
          maxEdges: 500,
          dompurifyConfig: {
            USE_PROFILES: { html: true }
          }
        });
        mermaidInitialized = true;
      } catch (err) {
        console.error('Failed to initialize mermaid:', err);
      }
    }
  }, []);

  // Clean content when it changes
  useEffect(() => {
    cleanedContent.current = cleanMermaidSyntax(content);
  }, [content]);

  const renderMermaid = useCallback(async () => {
    if (!cleanedContent.current.trim()) {
      return;
    }

    setIsRendering(true);
    setError(null);
    
    try {
      // Generate a new unique ID for each render to avoid conflicts
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Basic syntax validation - updated for Mermaid 11.x
      const diagramContent = cleanedContent.current;
      
      if (!diagramContent.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|gantt|pie|gitGraph|journey|quadrantChart|requirementDiagram|erDiagram|mindmap|timeline|sankey|block-beta|xychart-beta|packet-beta|architecture-beta|c4Context|c4Container|c4Component|c4Dynamic|c4Deployment)/)) {
        throw new Error('Invalid diagram type. Please start with a valid Mermaid diagram declaration.');
      }
      
      // Ensure we have a valid DOM reference before proceeding
      if (!mermaidRef.current) {
        throw new Error('Mermaid container not available');
      }
      
      // Clear any existing SVG content first
      mermaidRef.current.innerHTML = '';
      
      // Create a temporary container for mermaid to work with
      // This helps avoid DOM manipulation issues
      const tempDiv = document.createElement('div');
      tempDiv.id = id;
      tempDiv.style.visibility = 'hidden';
      document.body.appendChild(tempDiv);
      
      try {
        // Render the mermaid diagram with temporary container
        const result = await mermaid.render(id, diagramContent);
        
        // Set the SVG content and track what was rendered
        setSvgContent(result.svg);
        lastRenderedContent.current = diagramContent;
        
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram';
        
        // Provide helpful error messages
        if (errorMessage.includes('Parse error') || errorMessage.includes('syntax')) {
          setError(`Syntax error: ${errorMessage}. Please check your diagram syntax.`);
        } else if (errorMessage.includes('firstChild') || errorMessage.includes('null')) {
          setError('Rendering error: DOM element not available. Please try again.');
        } else {
          setError(errorMessage);
        }
        setSvgContent('');
        lastRenderedContent.current = ''; // Reset on error
      } finally {
        // Clean up temporary container
        if (tempDiv.parentNode) {
          tempDiv.parentNode.removeChild(tempDiv);
        }
      }
    } finally {
      setIsRendering(false);
    }
  }, []);

  // Render mermaid diagram when switching to preview or content changes
  useEffect(() => {
    if (activeTab === 'preview' && cleanedContent.current.trim()) {
      // Clear any existing timeout
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      
      // Check if we need to re-render or just re-insert existing SVG
      const contentChanged = cleanedContent.current !== lastRenderedContent.current;
      const domIsEmpty = !mermaidRef.current?.innerHTML?.trim();
      
      if (contentChanged || !svgContent) {
        // Content changed or no SVG - need full re-render
        renderTimeoutRef.current = setTimeout(() => {
          renderMermaid();
        }, 100);
      } else if (svgContent && domIsEmpty && mermaidRef.current) {
        // Have SVG but DOM is empty - just re-insert
        try {
          mermaidRef.current.innerHTML = svgContent;
        } catch (err) {
          console.error('Error re-inserting SVG:', err);
          // If re-insertion fails, do a full re-render
          renderTimeoutRef.current = setTimeout(() => {
            renderMermaid();
          }, 100);
        }
      }
    }

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [activeTab, content, svgContent, renderMermaid]);

  // Update DOM when SVG content changes
  useEffect(() => {
    if (mermaidRef.current && svgContent) {
      try {
        mermaidRef.current.innerHTML = svgContent;
      } catch (err) {
        console.error('Error updating DOM with SVG content:', err);
        setError('Error displaying diagram. Please try refreshing.');
      }
    }
  }, [svgContent]);

  // Download functions
  const downloadSvg = useCallback(() => {
    if (!svgContent) return;
    
    vscode.postMessage({
      command: 'downloadMermaid',
      content: svgContent,
      format: 'svg'
    });
  }, [svgContent, vscode]);

  const downloadPng = useCallback(() => {
    if (!svgContent) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    
    // Use base64 data URL for SVG to avoid some security/tainting issues
    const svgBase64 = btoa(unescape(encodeURIComponent(svgContent)));
    const url = `data:image/svg+xml;base64,${svgBase64}`;

    img.onload = () => {
      // Create a temporary SVG element to measure its actual size
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svgElement = svgDoc.documentElement;
      
      // Try to get dimensions from SVG attributes
      let width = parseFloat(svgElement.getAttribute('width') || '0');
      let height = parseFloat(svgElement.getAttribute('height') || '0');
      const viewBox = svgElement.getAttribute('viewBox');
      let viewBoxWidth = 0;
      let viewBoxHeight = 0;

      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(parseFloat);
        if (parts.length === 4) {
          viewBoxWidth = parts[2];
          viewBoxHeight = parts[3];
        }
      }

      // If width/height are percentages or missing, use viewBox
      if (!width || isNaN(width) || svgElement.getAttribute('width')?.includes('%')) {
        width = viewBoxWidth || img.naturalWidth || img.width || 800;
      }
      if (!height || isNaN(height) || svgElement.getAttribute('height')?.includes('%')) {
        height = viewBoxHeight || img.naturalHeight || img.height || 600;
      }

      // Final check to maintain aspect ratio if one dimension is still missing
      if (viewBoxWidth && viewBoxHeight) {
        const aspectRatio = viewBoxWidth / viewBoxHeight;
        if (width && !height) height = width / aspectRatio;
        else if (!width && height) width = height * aspectRatio;
      }

      // Fallback to defaults
      width = width || 800;
      height = height || 600;
      
      canvas.width = width * 2; // Higher resolution
      canvas.height = height * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width, height);
      
      try {
        const pngDataUrl = canvas.toDataURL('image/png');
        vscode.postMessage({
          command: 'downloadMermaid',
          content: pngDataUrl,
          format: 'png'
        });
      } catch (err) {
        console.error('Failed to export canvas to PNG:', err);
        vscode.postMessage({
          command: 'showError',
          message: '由于浏览器安全限制，无法生成 PNG。这通常是因为图表中包含了复杂的 HTML 标签。请尝试下载 SVG 格式。'
        });
      }
    };
    img.src = url;
  }, [svgContent, vscode]);

  const renderPreviewTab = () => {
    if (error) {
      return (
        <div className="mermaid-error">
          <div className="error-icon">⚠️</div>
          <div className="error-message">
            <strong>Diagram Error:</strong>
            <pre>{error}</pre>
          </div>
        </div>
      );
    }

    if (isRendering) {
      return (
        <div className="mermaid-loading">
          <div className="loading-spinner"></div>
          <span>正在渲染图表...</span>
        </div>
      );
    }

    return (
      <div className="mermaid-preview">
        {svgContent && (
          <div className="mermaid-actions">
            <button 
              onClick={downloadSvg} 
              className="action-button" 
              title="下载 SVG"
            >
              <i className="codicon codicon-file-code"></i>
            </button>
            <button 
              onClick={downloadPng} 
              className="action-button" 
              title="下载 PNG"
            >
              <i className="codicon codicon-file-media"></i>
            </button>
            <button 
              onClick={() => setIsFullscreen(true)} 
              className="action-button" 
              title="全屏查看"
            >
              <i className="codicon codicon-screen-full"></i>
            </button>
          </div>
        )}
        <div 
          ref={mermaidRef} 
          className="mermaid-container"
          onClick={() => svgContent && setIsFullscreen(true)}
          style={{ cursor: svgContent ? 'pointer' : 'default' }}
          title={svgContent ? '点击全屏查看' : ''}
        />
        {!svgContent && !isRendering && (
          <div className="mermaid-empty">
            <p>图表内容为空或语法错误</p>
          </div>
        )}
      </div>
    );
  };

  const renderSourceTab = () => {
    return (
      <div className="mermaid-source">
        <pre className="source-code">
          <code>{content}</code>
        </pre>
      </div>
    );
  };

  return (
    <>
      <div className={`mermaid-renderer ${className}`}>
        {/* Tab navigation */}
        <div className="mermaid-tabs">
          <button
            className={`tab-button ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            预览
          </button>
          <button
            className={`tab-button ${activeTab === 'source' ? 'active' : ''}`}
            onClick={() => setActiveTab('source')}
          >
            源码
          </button>
        </div>

        {/* Tab content */}
        <div className="mermaid-content">
          {activeTab === 'preview' ? renderPreviewTab() : renderSourceTab()}
        </div>
      </div>
      
      <FullscreenModal 
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        svgContent={svgContent}
        originalContent={content}
        vscode={vscode}
      />
    </>
  );
};