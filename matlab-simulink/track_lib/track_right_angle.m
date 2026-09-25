function trk = track_right_angle()
%TRACK_RIGHT_ANGLE 直角弯：直行 1.0 m 后尖角右转 90°（+x 方向）再 1.0 m。
% 尖角近似（假设 3）：折线顶点按理想尖点建模。
trk.name = 'right_angle';
trk.segs = [ seg_line(1.0), seg_line(1.0, 0) ];  % 第二段绝对方向 0 rad（+x）
trk.closed = false;
end
