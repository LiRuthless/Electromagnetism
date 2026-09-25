function trk = track_loop_square()
%TRACK_LOOP_SQUARE 尖角正方形闭环（1.2 m 边长，压力测试用）：
% 四条边均以 absAngle 折转 90°，几何上精确回到原点。
trk.name = 'loop_square';
trk.segs = [ seg_line(1.2), ...              % +y
             seg_line(1.2, 0), ...           % +x
             seg_line(1.2, -pi/2), ...       % -y
             seg_line(1.2, pi) ];            % -x
trk.closed = true;
end
