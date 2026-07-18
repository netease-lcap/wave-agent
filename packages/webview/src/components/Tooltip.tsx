import React, { useState, useId, ReactElement, useRef, useCallback } from 'react';
import '../styles/Tooltip.css';

interface TooltipProps {
  text: string;
  children: ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  offset?: number;
  disabled?: boolean;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  text, 
  children, 
  position = 'top',
  offset = 8,
  disabled = false,
  className = ''
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const calculatePosition = useCallback(() => {
    if (!containerRef.current || !tooltipRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    let left = 0;
    let top = 0;
    
    switch (position) {
      case 'top':
        left = containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case 'bottom':
        left = containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.bottom + offset;
        break;
      case 'left':
        left = containerRect.left - tooltipRect.width - offset;
        top = containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case 'right':
        left = containerRect.right + offset;
        top = containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case 'top-left':
        left = containerRect.left;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case 'top-right':
        left = containerRect.right - tooltipRect.width;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case 'bottom-left':
        left = containerRect.left;
        top = containerRect.bottom + offset;
        break;
      case 'bottom-right':
        left = containerRect.right - tooltipRect.width;
        top = containerRect.bottom + offset;
        break;
    }
    
    setTooltipStyle({ left, top });
  }, [position, offset]);

  // When disabled, render children without tooltip wrapper
  if (disabled) {
    return children;
  }

  const handleShow = () => {
    setIsVisible(true);
    // Calculate position after tooltip is rendered
    requestAnimationFrame(calculatePosition);
  };
  const handleHide = () => setIsVisible(false);

  return (
    <span 
      className={`tooltip-container ${className}`}
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
      ref={containerRef}
    >
      {React.cloneElement(children, {
        'aria-describedby': id
      })}
      <div 
        id={id} 
        role="tooltip" 
        ref={tooltipRef}
        className={`tooltip-box tooltip-${position} ${isVisible ? 'visible' : ''}`}
        style={tooltipStyle}
      >
        {text}
      </div>
    </span>
  );
};
