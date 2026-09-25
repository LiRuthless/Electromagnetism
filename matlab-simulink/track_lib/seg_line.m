function seg = seg_line(len, absAngle, exitAngle)
%SEG_LINE 直线段定义（对应 TS 的 LineSegDef，数学模型.md §4.1 式 4.1）
%   len       段长 m
%   absAngle  可选：绝对铺设方向（rad，从 +x 起算）——鼠标连线/直角弯尖角用
%   exitAngle 可选：出段航向覆盖（仅正六边形环岛末边用）
seg = struct('kind','line', 'len',len, ...
    'absAngle',[], 'exitAngle',[], 'R',[], 'angleDeg',[], 'turn','');
if nargin >= 2, seg.absAngle = absAngle; end
if nargin >= 3, seg.exitAngle = exitAngle; end
end
