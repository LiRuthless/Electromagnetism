function seg = seg_arc(R, angleDeg, turn)
%SEG_ARC 圆弧段定义（对应 TS 的 ArcSegDef，数学模型.md §4.1 式 4.2）
%   R        半径 m
%   angleDeg 圆心角（度，>0）
%   turn     'left' | 'right'（沿当前切线方向接续）
seg = struct('kind','arc', 'len',[], 'absAngle',[], 'exitAngle',[], ...
    'R',R, 'angleDeg',angleDeg, 'turn',turn);
end
