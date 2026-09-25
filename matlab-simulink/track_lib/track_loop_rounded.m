function trk = track_loop_rounded()
%TRACK_LOOP_ROUNDED 圆角矩形闭环赛道（标准循迹赛道样式）：
% 直 1.5 m → 右弧 R0.3/90° → 直 1.0 m → 右弧 → 直 1.5 m → 右弧 → 直 1.0 m → 右弧，
% 几何上精确回到原点、航向恢复 +y，闭环 gap = 0，无需吸合段。
trk.name = 'loop_rounded';
trk.segs = [ seg_line(1.5), seg_arc(0.3, 90, 'right'), ...
             seg_line(1.0), seg_arc(0.3, 90, 'right'), ...
             seg_line(1.5), seg_arc(0.3, 90, 'right'), ...
             seg_line(1.0), seg_arc(0.3, 90, 'right') ];
trk.closed = true;
end
