function [xn, yn, thn] = em_stepCar(x, y, th, vL, vR, W, dt)
%EM_STEPCAR 两轮差速运动学单步积分（数学模型.md §8.5 式 8.8/8.9）。
% 半隐式欧拉：先转后移——θ 先更新，再用 θ(n+1) 平移。
%   v = (vR+vL)/2，ω = (vR−vL)/W
v = (vL + vR)/2;
omega = (vR - vL)/max(W, 1e-4);
thn = th + omega*dt;
xn = x + v*cos(thn)*dt;
yn = y + v*sin(thn)*dt;
end
